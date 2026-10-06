import "server-only";
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { attendance, blockCalls, conflicts, eventBlocks, events, guardianships, people, users } from "@/db/schema";
import { loadCastIndex, resolveTarget, sceneLabel, targetLabel, type ProductionCastIndex } from "./calls";
import { callKey, personName, sceneShort, type CallRef, type EditorOptions, type EventInput } from "./schedule-shared";
import { toDateInput, toTimeInput } from "./time";

/*
 * Server-side schedule helpers shared by the schedule pages, their actions and My Calls.
 * Who-is-called logic always goes through the call engine in ./calls.
 */

type EventRow = typeof events.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Everything the event editor needs for the live "Who's called" preview and conflict warnings. */
export async function getEditorOptions(
  productionId: string,
  tz: string,
  defaultLocation: string | null,
  /** Load conflicts from a day before this (or now, whichever is earlier). */
  eventStart?: Date,
): Promise<EditorOptions> {
  const conflictsFrom = new Date(Math.min(Date.now(), eventStart?.getTime() ?? Infinity) - 86400_000);
  const idx = await loadCastIndex(productionId);
  const castIds = [...idx.allCast];
  const personRows = castIds.length ? await db.select().from(people).where(inArray(people.id, castIds)) : [];
  personRows.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));

  const scenes = [...idx.sceneById.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.act - b.act);
  const groups = [...idx.groupById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const roles = [...idx.roleById.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const resolved: Record<string, string[]> = {};
  const labels: Record<string, string> = {};
  const nameOf = new Map(personRows.map((p) => [p.id, personName(p)]));
  const add = (c: CallRef) => {
    const k = callKey(c);
    resolved[k] = [...resolveTarget(idx, c)];
    labels[k] = targetLabel(idx, c, (id) => nameOf.get(id) ?? "Individual");
  };
  add({ target: "all_cast", targetId: null });
  for (const s of scenes) add({ target: "scene", targetId: s.id });
  for (const g of groups) add({ target: "group", targetId: g.id });
  for (const r of roles) add({ target: "role", targetId: r.id });
  for (const p of personRows) add({ target: "person", targetId: p.id });

  const conflictRows = castIds.length
    ? await db
        .select()
        .from(conflicts)
        .where(
          and(
            inArray(conflicts.personId, castIds),
            gt(conflicts.endsAt, conflictsFrom),
            or(isNull(conflicts.productionId), eq(conflicts.productionId, productionId)),
          ),
        )
    : [];

  return {
    tz,
    defaultLocation: defaultLocation ?? "",
    scenes: scenes.map((s) => ({ id: s.id, act: s.act, short: sceneShort(s), name: s.name, label: sceneLabel(s) })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    people: personRows.map((p) => ({ id: p.id, name: personName(p), firstName: p.firstName, isMinor: p.isMinor })),
    resolved,
    labels,
    conflicts: conflictRows.map((c) => ({
      id: c.id,
      personId: c.personId,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      note: c.note,
    })),
  };
}

/** True when every call target belongs to the production in idx (never trust ids from the client). */
export function callTargetsBelong(idx: ProductionCastIndex, calls: CallRef[]) {
  return calls.every((c) => {
    switch (c.target) {
      case "all_cast":
        return c.targetId === null;
      case "scene":
        return !!c.targetId && idx.sceneById.has(c.targetId);
      case "role":
        return !!c.targetId && idx.roleById.has(c.targetId);
      case "group":
        return !!c.targetId && idx.groupById.has(c.targetId);
      case "person":
        return !!c.targetId && idx.allCast.has(c.targetId);
    }
  });
}

/** Conflicts for these people overlapping [from, to), limited to this production or production-less ones. */
export async function getConflictsFor(personIds: string[], productionId: string, from: Date, to: Date) {
  if (personIds.length === 0) return [];
  return db
    .select()
    .from(conflicts)
    .where(
      and(
        inArray(conflicts.personId, personIds),
        lt(conflicts.startsAt, to),
        gt(conflicts.endsAt, from),
        or(isNull(conflicts.productionId), eq(conflicts.productionId, productionId)),
      ),
    )
    .orderBy(asc(conflicts.startsAt));
}

/** minorId → guardian contacts (for call sheets; editors only). */
export async function getGuardianContacts(minorIds: string[]) {
  const out = new Map<string, { name: string; relationship: string; phone: string | null; email: string | null }[]>();
  if (minorIds.length === 0) return out;
  const rows = await db
    .select({ minorId: guardianships.minorId, relationship: guardianships.relationship, g: people, u: users })
    .from(guardianships)
    .innerJoin(people, eq(people.id, guardianships.guardianId))
    .leftJoin(users, eq(users.id, people.userId))
    .where(inArray(guardianships.minorId, minorIds));
  for (const r of rows) {
    const arr = out.get(r.minorId) ?? [];
    arr.push({
      name: personName(r.g),
      relationship: r.relationship,
      phone: r.g.phone ?? r.u?.phone ?? null,
      email: r.g.email ?? r.u?.email ?? null,
    });
    out.set(r.minorId, arr);
  }
  return out;
}

/** Load blocks + calls for an event in display order. */
export async function getEventBlocks(eventId: string) {
  const blocks = await db
    .select()
    .from(eventBlocks)
    .where(eq(eventBlocks.eventId, eventId))
    .orderBy(asc(eventBlocks.sortOrder), asc(eventBlocks.startsAt));
  const calls = blocks.length
    ? await db.select().from(blockCalls).where(inArray(blockCalls.blockId, blocks.map((b) => b.id)))
    : [];
  return blocks.map((b) => ({
    ...b,
    calls: calls.filter((c) => c.blockId === b.id).map((c) => ({ target: c.target, targetId: c.targetId }) as CallRef),
  }));
}

/** Shift an instant by whole days keeping its wall-clock time in tz (DST-safe). */
export function shiftDays(d: Date, days: number, tz: string) {
  return new Date(addDays(new TZDate(d.getTime(), tz), days).getTime());
}

/** Copy an event (+ blocks + calls) shifted by `days`, as a fresh draft. */
export async function copyEvent(tx: Tx, ev: EventRow, days: number, tz: string) {
  const [copy] = await tx
    .insert(events)
    .values({
      productionId: ev.productionId,
      kind: ev.kind,
      title: ev.title,
      startsAt: shiftDays(ev.startsAt, days, tz),
      endsAt: shiftDays(ev.endsAt, days, tz),
      location: ev.location,
      notes: ev.notes,
      status: "draft",
      revision: 0,
    })
    .returning();
  const blocks = await tx.select().from(eventBlocks).where(eq(eventBlocks.eventId, ev.id));
  for (const b of blocks) {
    const [nb] = await tx
      .insert(eventBlocks)
      .values({
        eventId: copy.id,
        startsAt: shiftDays(b.startsAt, days, tz),
        endsAt: shiftDays(b.endsAt, days, tz),
        title: b.title,
        leader: b.leader,
        location: b.location,
        notes: b.notes,
        sortOrder: b.sortOrder,
      })
      .returning();
    const calls = await tx.select().from(blockCalls).where(eq(blockCalls.blockId, b.id));
    if (calls.length) await tx.insert(blockCalls).values(calls.map((c) => ({ blockId: nb.id, target: c.target, targetId: c.targetId })));
  }
  return copy;
}

/** One-line summary of what an event rehearses: "Act 1 Sc 3, Pirate Band, Leads vocal session". */
export function blockSummary(
  idx: ProductionCastIndex,
  blocks: { title: string | null; calls: CallRef[] }[],
  max = 4,
) {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.title) parts.push(b.title);
    else
      for (const c of b.calls) {
        if (c.target === "scene") {
          const s = idx.sceneById.get(c.targetId ?? "");
          parts.push(s ? sceneShort(s) : "Scene");
        } else if (c.target !== "person") parts.push(targetLabel(idx, c));
      }
  }
  const uniq = [...new Set(parts)];
  return uniq.length > max ? `${uniq.slice(0, max).join(", ")} +${uniq.length - max} more` : uniq.join(", ");
}

/** Shape an event (+ blocks) as the editor's input, with wall-clock values in tz. */
export function eventToInput(
  ev: EventRow,
  blocks: Awaited<ReturnType<typeof getEventBlocks>>,
  tz: string,
): EventInput {
  return {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    date: toDateInput(ev.startsAt, tz),
    start: toTimeInput(ev.startsAt, tz),
    end: toTimeInput(ev.endsAt, tz),
    location: ev.location ?? "",
    notes: ev.notes ?? "",
    blocks: blocks.map((b) => ({
      start: toTimeInput(b.startsAt, tz),
      end: toTimeInput(b.endsAt, tz),
      title: b.title ?? "",
      leader: b.leader ?? "",
      location: b.location ?? "",
      notes: b.notes ?? "",
      calls: b.calls,
    })),
  };
}

/* ───────────── Attendance ───────────── */

export type AttendanceStatus = (typeof attendance.$inferSelect)["status"];

/**
 * People called to this event who reported an overlapping conflict (personId → note), and — the
 * first time the attendance sheet opens for the event — mark them "excused". It runs once per
 * event (events.autoExcusedAt), so a stage manager who clears an auto-excuse isn't overridden on
 * the next load; later-reported conflicts are shown as a hint instead.
 */
export async function ensureExcusedForConflicts(
  eventId: string,
  productionId: string,
  calls: Map<string, { callAt: Date; releaseAt: Date }>,
  markedByUserId: string,
): Promise<Map<string, string>> {
  const ids = [...calls.keys()];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const from = new Date(Math.min(...[...calls.values()].map((c) => c.callAt.getTime())));
  const to = new Date(Math.max(...[...calls.values()].map((c) => c.releaseAt.getTime())));
  const cs = await getConflictsFor(ids, productionId, from, to);
  for (const c of cs) {
    const call = calls.get(c.personId);
    if (call && c.startsAt < call.releaseAt && call.callAt < c.endsAt && !out.has(c.personId))
      out.set(c.personId, c.note ? `Conflict: ${c.note}` : "Reported a conflict");
  }
  const [first] = await db
    .update(events)
    .set({ autoExcusedAt: new Date() })
    .where(and(eq(events.id, eventId), isNull(events.autoExcusedAt)))
    .returning({ id: events.id });
  if (first && out.size) {
    await db
      .insert(attendance)
      .values([...out].map(([personId, note]) => ({ eventId, personId, status: "excused" as const, markedByUserId, note })))
      .onConflictDoNothing();
  }
  return out;
}


export type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Events this person was marked for. */
  marked: number;
  lastAbsentAt: Date | null;
};

/** Per-person attendance counts across a production's events (personId → summary). */
export async function getAttendanceSummary(productionId: string): Promise<Map<string, AttendanceSummary>> {
  const rows = await db
    .select({ personId: attendance.personId, status: attendance.status, startsAt: events.startsAt })
    .from(attendance)
    .innerJoin(events, eq(events.id, attendance.eventId))
    .where(eq(events.productionId, productionId));
  const out = new Map<string, AttendanceSummary>();
  for (const r of rows) {
    const s = out.get(r.personId) ?? { present: 0, late: 0, absent: 0, excused: 0, marked: 0, lastAbsentAt: null };
    s[r.status] += 1;
    s.marked += 1;
    if (r.status === "absent" && (!s.lastAbsentAt || r.startsAt > s.lastAbsentAt)) s.lastAbsentAt = r.startsAt;
    out.set(r.personId, s);
  }
  return out;
}
