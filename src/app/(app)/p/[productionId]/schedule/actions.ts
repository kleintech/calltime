"use server";

import { and, eq, gte, lt, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { blockCalls, eventBlocks, events } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { loadCastIndex } from "@/lib/calls";
import { callTargetsBelong, copyEvent, getEventBlocks, materialFingerprint } from "@/lib/schedule";
import { eventInputSchema, type EventInput } from "@/lib/schedule-shared";
import { fromLocalInput, toDateInput } from "@/lib/time";

export type ActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const uuid = z.uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`, "layout");
  revalidatePath("/home", "layout");
}

async function findEvent(productionId: string, eventId: string) {
  if (!uuid.safeParse(eventId).success) return null;
  return (
    (await db.query.events.findFirst({ where: and(eq(events.id, eventId), eq(events.productionId, productionId)) })) ?? null
  );
}

/** Create or update an event with all its blocks and calls. intent: keep status, or publish. */
export async function saveEvent(productionId: string, input: EventInput, intent: "save" | "publish" | "draft"): Promise<ActionResult> {
  const { org } = await requireProductionEditor(productionId);
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event" };
  const data = parsed.data;
  if (!["save", "publish", "draft"].includes(intent)) return { ok: false, error: "Invalid action" };
  const tz = org.timezone;

  const existing = data.id ? await findEvent(productionId, data.id) : null;
  if (data.id && !existing) return { ok: false, error: "That event no longer exists." };

  const idx = await loadCastIndex(productionId);
  if (!callTargetsBelong(idx, data.blocks.flatMap((b) => b.calls))) {
    return { ok: false, error: "Some called scenes, roles, groups or people aren't part of this production." };
  }

  const startsAt = fromLocalInput(data.date, tz, data.start);
  const endsAt = fromLocalInput(data.date, tz, data.end);
  const blocks = data.blocks.map((b, i) => ({
    startsAt: fromLocalInput(data.date, tz, b.start),
    endsAt: fromLocalInput(data.date, tz, b.end),
    title: b.title || null,
    leader: b.leader || null,
    location: b.location || null,
    notes: b.notes || null,
    sortOrder: i,
    calls: dedupeCalls(b.calls),
  }));
  const location = data.location || null;

  let status = existing?.status ?? "draft";
  let publishedAt = existing?.publishedAt ?? null;
  let revision = existing?.revision ?? 0;
  let changedAt = existing?.changedAt ?? null;
  let changeNote = existing?.changeNote ?? null;
  const bump = () => {
    revision += 1;
    changedAt = new Date();
    changeNote = data.changeNote || null; // a new change replaces the old explanation
  };
  if (existing && existing.status !== "draft") {
    const before = materialFingerprint(existing, await getEventBlocks(existing.id));
    const after = materialFingerprint({ startsAt, endsAt, location }, blocks);
    if (before !== after) bump();
    else if (data.changeNote) changeNote = data.changeNote;
  }
  if (intent === "publish") {
    if (status === "draft" && publishedAt && existing) bump(); // re-publishing something families saw before
    status = "published";
    publishedAt ??= new Date();
  } else if (intent === "draft") {
    status = "draft";
  }

  const id = await db.transaction(async (tx) => {
    const values = {
      kind: data.kind,
      title: data.title,
      startsAt,
      endsAt,
      location,
      notes: data.notes || null,
      status,
      publishedAt,
      revision,
      changedAt,
      changeNote,
    };
    let eventId: string;
    if (existing) {
      await tx.update(events).set(values).where(eq(events.id, existing.id));
      await tx.delete(eventBlocks).where(eq(eventBlocks.eventId, existing.id));
      eventId = existing.id;
    } else {
      const [row] = await tx
        .insert(events)
        .values({ ...values, productionId })
        .returning({ id: events.id });
      eventId = row.id;
    }
    for (const b of blocks) {
      const { calls, ...rest } = b;
      const [blk] = await tx
        .insert(eventBlocks)
        .values({ ...rest, eventId })
        .returning({ id: eventBlocks.id });
      if (calls.length) await tx.insert(blockCalls).values(calls.map((c) => ({ ...c, blockId: blk.id })));
    }
    return eventId;
  });

  revalidate(productionId);
  return { ok: true, id };
}

function dedupeCalls<T extends { target: string; targetId: string | null }>(calls: T[]) {
  const seen = new Set<string>();
  return calls.filter((c) => {
    const k = `${c.target}:${c.targetId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** publish | unpublish (back to draft) | cancel | restore (cancelled → published). */
export async function setEventStatus(
  productionId: string,
  eventId: string,
  action: "publish" | "unpublish" | "cancel" | "restore",
  reason?: string,
): Promise<ActionResult> {
  await requireProductionEditor(productionId);
  const note = z.string().trim().max(300).optional().safeParse(reason);
  if (!note.success) return { ok: false, error: "Keep the note under 300 characters." };
  const now = new Date();
  const ev = await findEvent(productionId, eventId);
  if (!ev) return { ok: false, error: "That event no longer exists." };

  let patch: Partial<typeof events.$inferInsert>;
  switch (action) {
    case "publish":
      if (ev.status === "published") return { ok: true, id: ev.id };
      patch = {
        status: "published",
        publishedAt: ev.publishedAt ?? now,
        ...(ev.publishedAt ? { revision: ev.revision + 1, changedAt: now } : {}),
      };
      break;
    case "unpublish":
      patch = { status: "draft" };
      break;
    case "cancel":
      if (ev.status === "cancelled") return { ok: true, id: ev.id };
      patch =
        ev.status === "published"
          ? { status: "cancelled", revision: ev.revision + 1, changedAt: now, changeNote: note.data || null }
          : { status: "cancelled" };
      break;
    case "restore":
      if (ev.status !== "cancelled") return { ok: true, id: ev.id };
      patch = { status: "published", publishedAt: ev.publishedAt ?? now, revision: ev.revision + 1, changedAt: now, changeNote: note.data || null };
      break;
    default:
      return { ok: false, error: "Invalid action" };
  }
  await db.update(events).set(patch).where(eq(events.id, ev.id));
  revalidate(productionId);
  return { ok: true, id: ev.id };
}

export async function deleteEvent(productionId: string, eventId: string): Promise<ActionResult> {
  await requireProductionEditor(productionId);
  const ev = await findEvent(productionId, eventId);
  if (!ev) return { ok: false, error: "That event no longer exists." };
  await db.delete(events).where(eq(events.id, ev.id));
  revalidate(productionId);
  return { ok: true };
}

/** Copy an event to another date (same wall-clock times) as a draft. */
export async function duplicateEvent(productionId: string, eventId: string, toDate: string): Promise<ActionResult> {
  const { org } = await requireProductionEditor(productionId);
  if (!ymd.safeParse(toDate).success) return { ok: false, error: "Pick a date" };
  const ev = await findEvent(productionId, eventId);
  if (!ev) return { ok: false, error: "That event no longer exists." };
  const days = dayDiff(toDate, toDateInput(ev.startsAt, org.timezone));
  const copy = await db.transaction((tx) => copyEvent(tx, ev, days, org.timezone));
  revalidate(productionId);
  return { ok: true, id: copy.id };
}

/** Publish every draft in the production. */
export async function publishAllDrafts(productionId: string): Promise<ActionResult> {
  await requireProductionEditor(productionId);
  const drafts = await db
    .select()
    .from(events)
    .where(and(eq(events.productionId, productionId), eq(events.status, "draft")));
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const ev of drafts) {
      await tx
        .update(events)
        .set(
          ev.publishedAt
            ? { status: "published", revision: ev.revision + 1, changedAt: now }
            : { status: "published", publishedAt: now },
        )
        .where(eq(events.id, ev.id));
    }
  });
  revalidate(productionId);
  return { ok: true, count: drafts.length };
}

/** Copy the (non-cancelled) events of the week starting weekStart (local Monday) to the following week, as drafts. */
export async function duplicateWeek(productionId: string, weekStart: string): Promise<ActionResult> {
  const { org } = await requireProductionEditor(productionId);
  if (!ymd.safeParse(weekStart).success) return { ok: false, error: "Invalid week" };
  const tz = org.timezone;
  const from = fromLocalInput(weekStart, tz, "00:00");
  const to = fromLocalInput(addYmd(weekStart, 7), tz, "00:00");
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.productionId, productionId),
        gte(events.startsAt, from),
        lt(events.startsAt, to),
        ne(events.status, "cancelled"),
      ),
    );
  if (rows.length === 0) return { ok: false, error: "Nothing to copy in that week." };
  await db.transaction(async (tx) => {
    for (const ev of rows) await copyEvent(tx, ev, 7, tz);
  });
  revalidate(productionId);
  return { ok: true, count: rows.length };
}

/* date-string helpers (calendar math on yyyy-mm-dd, tz-agnostic) */
function ymdToUtc(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function dayDiff(a: string, b: string) {
  return Math.round((ymdToUtc(a) - ymdToUtc(b)) / 86400_000);
}
function addYmd(s: string, days: number) {
  return new Date(ymdToUtc(s) + days * 86400_000).toISOString().slice(0, 10);
}
