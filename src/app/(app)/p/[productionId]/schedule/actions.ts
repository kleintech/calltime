"use server";

import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { blockCalls, eventBlocks, events, type eventChanges } from "@/db/schema";
import { isMaterialChange, scheduleChangeNotification, schedulePublishNotification, recordEventChange, snapshotEvent } from "@/lib/changes";
import { requireProductionEditor } from "@/lib/access";
import { loadCastIndex } from "@/lib/calls";
import { callTargetsBelong, copyEvent } from "@/lib/schedule";
import { eventInputSchema, type EventInput } from "@/lib/schedule-shared";
import { fromLocalInput, toDateInput } from "@/lib/time";

type ChangeRow = typeof eventChanges.$inferSelect;

export type ActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const uuid = z.uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Push notifications: queued with after() inside the helpers, so call only after the tx commits. */
function notifyAfterResponse(change: ChangeRow | null, firstPublishedIds: string[]) {
  scheduleChangeNotification(change);
  for (const id of firstPublishedIds) schedulePublishNotification(id);
}

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
  const { org, user } = await requireProductionEditor(productionId);
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

  const note = data.changeNote?.trim() || null;
  // Filled inside the transaction; push notifications go out only after it commits.
  let change: ChangeRow | null = null;
  let firstPublish = false;

  const id = await db.transaction(async (tx) => {
    const base = {
      kind: data.kind,
      title: data.title,
      startsAt,
      endsAt,
      location,
      notes: data.notes || null,
    };
    const writeBlocks = async (eventId: string) => {
      for (const b of blocks) {
        const { calls, ...rest } = b;
        const [blk] = await tx
          .insert(eventBlocks)
          .values({ ...rest, eventId })
          .returning({ id: eventBlocks.id });
        if (calls.length) await tx.insert(blockCalls).values(calls.map((c) => ({ ...c, blockId: blk.id })));
      }
    };

    if (!existing) {
      const [row] = await tx
        .insert(events)
        .values({
          ...base,
          productionId,
          status: intent === "publish" ? "published" : "draft",
          publishedAt: intent === "publish" ? new Date() : null,
        })
        .returning({ id: events.id });
      await writeBlocks(row.id);
      firstPublish = intent === "publish";
      return row.id;
    }

    // Lock the row so concurrent saves serialize and each material change gets its own revision.
    const [locked] = await tx.select().from(events).where(eq(events.id, existing.id)).for("update");
    const before = await snapshotEvent(tx, locked.id);
    const republish = intent === "publish" && locked.status === "draft" && !!locked.publishedAt;
    firstPublish = intent === "publish" && locked.status === "draft" && !locked.publishedAt;
    await tx
      .update(events)
      .set({
        ...base,
        ...(intent === "publish" ? { status: "published" as const, publishedAt: locked.publishedAt ?? new Date() } : {}),
        ...(intent === "draft" ? { status: "draft" as const } : {}),
      })
      .where(eq(events.id, locked.id));
    await tx.delete(eventBlocks).where(eq(eventBlocks.eventId, locked.id));
    await writeBlocks(locked.id);
    const after = await snapshotEvent(tx, locked.id);

    // Material = something families would notice (time, place, anyone's call/reasons/room).
    // Leader/notes/title tweaks save without a revision bump or "Updated" badge.
    // Only a live (published) event can change for families: edits to drafts or cancelled events record nothing.
    const material = locked.status === "published" && !!before && !!after && isMaterialChange(before, after);
    // Leaving / re-entering families' schedules is a change too ("Removed from…" / "Back on…").
    const unpublishing = intent === "draft" && locked.status !== "draft";
    if (material || republish || unpublishing) {
      const [row] = await tx
        .update(events)
        .set({ revision: sql`${events.revision} + 1`, changedAt: new Date() })
        .where(eq(events.id, locked.id))
        .returning();
      if (before && after) {
        after.event = row;
        change = await recordEventChange(tx, { before, after, changedByUserId: user.id, note });
        const changeNote = (note ?? change?.summary)?.slice(0, 300);
        if (changeNote) await tx.update(events).set({ changeNote }).where(eq(events.id, locked.id));
      }
    } else if (note) {
      await tx.update(events).set({ changeNote: note }).where(eq(events.id, locked.id));
    }
    return locked.id;
  });

  notifyAfterResponse(change, firstPublish ? [id] : []);
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
  const { user } = await requireProductionEditor(productionId);
  const note = z.string().trim().max(300).optional().safeParse(reason);
  if (!note.success) return { ok: false, error: "Keep the note under 300 characters." };
  const now = new Date();
  const found = await findEvent(productionId, eventId);
  if (!found) return { ok: false, error: "That event no longer exists." };
  const why = note.data || null;
  let change: ChangeRow | null = null;
  let firstPublish = false;

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    const [ev] = await tx.select().from(events).where(eq(events.id, found.id)).for("update");
    let patch: Partial<typeof events.$inferInsert>;
    let material = false;
    switch (action) {
      case "publish":
        if (ev.status === "published") return { ok: true, id: ev.id };
        patch = { status: "published", publishedAt: ev.publishedAt ?? now };
        firstPublish = !ev.publishedAt;
        if (ev.publishedAt) patch = { ...patch, revision: ev.revision + 1, changedAt: now }; // families saw it before
        material = ev.status === "cancelled" || !!ev.publishedAt; // reinstated or "Back on the schedule"
        break;
      case "unpublish":
        if (ev.status === "draft") return { ok: true, id: ev.id };
        patch = { status: "draft", revision: ev.revision + 1, changedAt: now };
        material = true; // "Removed from the schedule" for the families who were called
        break;
      case "cancel":
        if (ev.status === "cancelled") return { ok: true, id: ev.id };
        // Cancelling a draft would put it in front of families for the first time. Delete it instead.
        if (ev.status === "draft") return { ok: false, error: "Drafts aren't visible to families. Delete it instead, or publish it first." };
        patch =
          ev.status === "published"
            ? // replace (not keep) the old note so a stale "what changed" isn't read as the cancel reason
              { status: "cancelled", revision: ev.revision + 1, changedAt: now, changeNote: why }
            : { status: "cancelled" };
        material = ev.status === "published";
        break;
      case "restore":
        if (ev.status !== "cancelled") return { ok: true, id: ev.id };
        patch = { status: "published", publishedAt: ev.publishedAt ?? now, revision: ev.revision + 1, changedAt: now, changeNote: why };
        material = true;
        break;
      default:
        return { ok: false, error: "Invalid action" };
    }
    const before = material ? await snapshotEvent(tx, ev.id) : null;
    await tx.update(events).set(patch).where(eq(events.id, ev.id));
    if (before) {
      const after = await snapshotEvent(tx, ev.id);
      change = await recordEventChange(tx, { before, after, changedByUserId: user.id, note: why });
      if (!why && change) await tx.update(events).set({ changeNote: change.summary.slice(0, 300) }).where(eq(events.id, ev.id));
    }
    return { ok: true, id: ev.id };
  });
  if (!result.ok) return result;
  notifyAfterResponse(change, firstPublish ? [found.id] : []);
  revalidate(productionId);
  return result;
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
  const { user } = await requireProductionEditor(productionId);
  const drafts = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.productionId, productionId), eq(events.status, "draft")));
  const changes: ChangeRow[] = [];
  const firstPublished: string[] = [];
  let count = 0;
  // One transaction per event, same as setEventStatus("publish"): lock, snapshot, bump, record.
  for (const { id } of drafts) {
    await db.transaction(async (tx) => {
      const [ev] = await tx.select().from(events).where(eq(events.id, id)).for("update");
      if (!ev || ev.status !== "draft") return; // published by someone else meanwhile
      const now = new Date();
      const before = ev.publishedAt ? await snapshotEvent(tx, ev.id) : null;
      await tx
        .update(events)
        .set(
          ev.publishedAt
            ? { status: "published", revision: sql`${events.revision} + 1`, changedAt: now }
            : { status: "published", publishedAt: now },
        )
        .where(eq(events.id, ev.id));
      count += 1;
      if (!ev.publishedAt) {
        firstPublished.push(ev.id);
        return;
      }
      const after = await snapshotEvent(tx, ev.id);
      const change = await recordEventChange(tx, { before, after, changedByUserId: user.id });
      if (change) {
        changes.push(change);
        await tx.update(events).set({ changeNote: change.summary.slice(0, 300) }).where(eq(events.id, ev.id));
      }
    });
  }
  for (const c of changes) scheduleChangeNotification(c);
  notifyAfterResponse(null, firstPublished);
  revalidate(productionId);
  return { ok: true, count };
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
