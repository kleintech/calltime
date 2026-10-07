import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import {
  blockCalls,
  changeAcks,
  eventBlocks,
  eventChanges,
  events,
  guardianships,
  organizations,
  people,
  productions,
  roleAssignments,
  roleGroupMembers,
  roleGroups,
  roles,
  sceneRoles,
  scenes,
  users,
} from "@/db/schema";
import { getCoveredPersonIds } from "./access";
import { type ProductionCastIndex, getEventCallSheet, resolveTarget, targetLabel } from "./calls";
import { dayKey, fmtDay, fmtRange, fmtTime } from "./time";

/**
 * Change tracking for published events — per person.
 *
 *   await db.transaction(async (tx) => {
 *     const before = await snapshotEvent(tx, eventId);
 *     …mutate the event / blocks; bump revision, set changedAt/changeNote…
 *     await recordEventChange(tx, { before, after: await snapshotEvent(tx, eventId), changedByUserId, note });
 *   });
 *
 * Snapshots include every called person's call/release/reasons, computed with the call engine's
 * resolution rules (resolveTarget) over data read through the SAME transaction, so the "after"
 * snapshot sees the uncommitted edit. A change row stores which people were actually affected
 * (their call moved, they were added/removed, what they rehearse changed, the location changed,
 * or the event was cancelled/reinstated) and a summary for each. Families are only told about
 * changes that affect someone they cover. A change row is written only when the event was
 * visible to families before (published or cancelled) and something changed.
 */

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type EventRow = typeof events.$inferSelect;
type CallTarget = { target: "scene" | "role" | "group" | "person" | "all_cast"; targetId: string | null };
type PersonCallSnap = { callAt: number; releaseAt: number; reasons: string[]; rooms: string[] };

export type EventSnapshot = {
  event: EventRow;
  tz: string;
  blocks: { startsAt: Date; endsAt: Date; title: string | null; location: string | null; calls: CallTarget[] }[];
  /** "scene:<id>" → "Act 1 Sc 3: Pirate Cave", etc. Resolved at snapshot time so deletions still read well. */
  labels: Record<string, string>;
  /** personId → their call for this event (absent = not called). */
  calls: Record<string, PersonCallSnap>;
};

const key = (c: CallTarget) => `${c.target}:${c.targetId ?? ""}`;

/** loadCastIndex from lib/calls, but reading through `q` so it works inside a transaction. */
async function loadCastIndexWith(q: DbOrTx, productionId: string): Promise<ProductionCastIndex> {
  // Sequential on purpose: a transaction must use one client, in order.
  const roleRows = await q.select().from(roles).where(eq(roles.productionId, productionId));
  const sceneRows = await q.select().from(scenes).where(eq(scenes.productionId, productionId));
  const groupRows = await q.select().from(roleGroups).where(eq(roleGroups.productionId, productionId));
  const roleIds = roleRows.map((r) => r.id);
  const assignRows = roleIds.length ? await q.select().from(roleAssignments).where(inArray(roleAssignments.roleId, roleIds)) : [];
  const sceneRoleRows = roleIds.length ? await q.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds)) : [];
  const memberRows = roleIds.length ? await q.select().from(roleGroupMembers).where(inArray(roleGroupMembers.roleId, roleIds)) : [];
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  const idx: ProductionCastIndex = {
    productionId,
    roleById: new Map(roleRows.map((r) => [r.id, r])),
    sceneById: new Map(sceneRows.map((s) => [s.id, s])),
    groupById: new Map(groupRows.map((g) => [g.id, g])),
    assigneesByRole: new Map(),
    rolesByScene: new Map(),
    rolesByGroup: new Map(),
    rolesByPerson: new Map(),
    allCast: new Set(),
  };
  for (const a of assignRows) {
    push(idx.assigneesByRole, a.roleId, { personId: a.personId, kind: a.kind });
    push(idx.rolesByPerson, a.personId, a.roleId);
    idx.allCast.add(a.personId);
  }
  for (const sr of sceneRoleRows) push(idx.rolesByScene, sr.sceneId, sr.roleId);
  for (const gm of memberRows) push(idx.rolesByGroup, gm.groupId, gm.roleId);
  return idx;
}

/** Capture an event, its blocks, call labels and every person's call. Use the mutation's `tx`. */
export async function snapshotEvent(q: DbOrTx, eventId: string): Promise<EventSnapshot | null> {
  const [row] = await q
    .select({ event: events, tz: organizations.timezone })
    .from(events)
    .innerJoin(productions, eq(productions.id, events.productionId))
    .innerJoin(organizations, eq(organizations.id, productions.orgId))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;
  const idx = await loadCastIndexWith(q, row.event.productionId);
  return (await buildSnapshots(q, idx, row.tz, [row.event]))[0];
}

/** Snapshots for several events of ONE production, sharing one cast index (bulk queries). */
async function buildSnapshots(q: DbOrTx, idx: ProductionCastIndex, tz: string, eventRows: EventRow[]): Promise<EventSnapshot[]> {
  if (eventRows.length === 0) return [];
  const blockRows = await q
    .select()
    .from(eventBlocks)
    .where(inArray(eventBlocks.eventId, eventRows.map((e) => e.id)))
    .orderBy(asc(eventBlocks.startsAt), asc(eventBlocks.sortOrder));
  const callRows = blockRows.length
    ? await q.select().from(blockCalls).where(inArray(blockCalls.blockId, blockRows.map((b) => b.id)))
    : [];
  const personIds = [...new Set(callRows.filter((c) => c.target === "person" && c.targetId).map((c) => c.targetId!))];
  const personRows = personIds.length ? await q.select().from(people).where(inArray(people.id, personIds)) : [];
  const personName = new Map(personRows.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

  return eventRows.map((event) => {
    const mine = blockRows.filter((b) => b.eventId === event.id);
    const blocks = mine.map((b) => ({
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      title: b.title,
      location: b.location,
      calls: callRows.filter((c) => c.blockId === b.id).map((c) => ({ target: c.target, targetId: c.targetId })),
    }));
    // Team-facing labels name the person; family-facing reasons say "Called individually".
    const labels: Record<string, string> = {};
    for (const bl of blocks) for (const c of bl.calls) labels[key(c)] = targetLabel(idx, c, (id) => personName.get(id) ?? "Individual");
    // Reasons are stored as stable keys ("scene:<id>", "title:<block title>", "person") and turned into
    // words when a change is described, so renaming a scene or role is not reported as a new call.
    const reasonFor = (c: CallTarget) => (c.target === "person" ? "person" : key(c));

    // Same rules as buildCallSheets: earliest block start → latest block end; reasons in block order.
    const calls: Record<string, PersonCallSnap> = {};
    for (const b of blocks) {
      const resolved = b.calls.map((c) => ({ c, ppl: resolveTarget(idx, c) }));
      const inBlock = new Set(resolved.flatMap((r) => [...r.ppl]));
      for (const pid of inBlock) {
        const reasons = resolved
          .filter((r) => r.ppl.has(pid))
          .map((r) => (b.title && r.c.target !== "scene" ? `title:${b.title}` : reasonFor(r.c)));
        const rooms = b.location ? [b.location] : [];
        const cur = calls[pid];
        if (!cur) calls[pid] = { callAt: b.startsAt.getTime(), releaseAt: b.endsAt.getTime(), reasons: [...new Set(reasons)], rooms };
        else {
          cur.callAt = Math.min(cur.callAt, b.startsAt.getTime());
          cur.releaseAt = Math.max(cur.releaseAt, b.endsAt.getTime());
          cur.reasons = [...new Set([...cur.reasons, ...reasons])];
          cur.rooms = [...new Set([...cur.rooms, ...rooms])];
        }
      }
    }
    return { event, tz, blocks, labels, calls };
  });
}

/**
 * Every upcoming published event of a production, snapshotted through `q`. With `only`, just those
 * events (an empty list snapshots nothing); `idx` reuses an already-loaded cast index.
 */
async function snapshotUpcoming(q: DbOrTx, productionId: string, only?: string[] | null, idx?: ProductionCastIndex) {
  if (only && only.length === 0) return [];
  const [org] = await q
    .select({ tz: organizations.timezone })
    .from(productions)
    .innerJoin(organizations, eq(organizations.id, productions.orgId))
    .where(eq(productions.id, productionId));
  if (!org) return [];
  const eventRows = await q
    .select()
    .from(events)
    .where(
      and(
        eq(events.productionId, productionId),
        eq(events.status, "published"),
        gte(events.endsAt, new Date()),
        ...(only ? [inArray(events.id, only)] : []),
      ),
    );
  if (eventRows.length === 0) return [];
  return buildSnapshots(q, idx ?? (await loadCastIndexWith(q, productionId)), org.tz, eventRows);
}

/** What a cast/breakdown/group edit touches, so only events that can be affected are diffed. */
export type TouchedTargets = { scenes?: string[]; roles?: string[]; groups?: string[]; people?: string[] };

/**
 * Upcoming published events whose calls could change when these targets change: events calling a
 * touched scene or group directly; for a touched role (or a touched person's roles) also every scene
 * and group that contains the role, the role itself, the person, and full-cast calls.
 */
async function relevantEventIds(q: DbOrTx, idx: ProductionCastIndex, productionId: string, touched: TouchedTargets): Promise<string[]> {
  const keys = new Set<string>();
  const addRole = (roleId: string) => {
    keys.add(`role:${roleId}`);
    keys.add("all_cast:");
    for (const [sceneId, rs] of idx.rolesByScene) if (rs.includes(roleId)) keys.add(`scene:${sceneId}`);
    for (const [groupId, rs] of idx.rolesByGroup) if (rs.includes(roleId)) keys.add(`group:${groupId}`);
  };
  for (const s of touched.scenes ?? []) keys.add(`scene:${s}`);
  for (const g of touched.groups ?? []) keys.add(`group:${g}`);
  for (const r of touched.roles ?? []) addRole(r);
  for (const p of touched.people ?? []) {
    keys.add(`person:${p}`);
    keys.add("all_cast:");
    for (const r of idx.rolesByPerson.get(p) ?? []) addRole(r);
  }
  if (keys.size === 0) return [];
  const conds = [...keys].map((k) => {
    const [target, id] = k.split(":") as [CallTarget["target"], string];
    return id ? and(eq(blockCalls.target, target), eq(blockCalls.targetId, id))! : eq(blockCalls.target, target);
  });
  const rows = await q
    .selectDistinct({ id: events.id })
    .from(blockCalls)
    .innerJoin(eventBlocks, eq(eventBlocks.id, blockCalls.blockId))
    .innerJoin(events, eq(events.id, eventBlocks.eventId))
    .where(and(eq(events.productionId, productionId), eq(events.status, "published"), gte(events.endsAt, new Date()), or(...conds)));
  return rows.map((r) => r.id);
}

/**
 * Run a cast / breakdown / group edit and record what it did to already-published, upcoming
 * events: anyone whose call appears, disappears, moves or changes content gets a change entry
 * and the event's revision (ICS SEQUENCE) is bumped. Must run inside a transaction:
 *
 *   const { result, changes } = await db.transaction((tx) =>
 *     withCallImpact(tx, productionId, user.id, () => assignRoles(…, tx)));
 *   for (const c of changes) scheduleChangeNotification(c);   // after commit
 */
export async function withCallImpact<T>(
  tx: DbOrTx,
  productionId: string,
  actorUserId: string | null,
  fn: (tx: DbOrTx) => Promise<T>,
  /** When known, only events that reference these targets are snapshotted and diffed (much faster). */
  touched?: TouchedTargets,
): Promise<{ result: T; changes: (typeof eventChanges.$inferSelect)[] }> {
  let only: string[] | null = null;
  let idx: ProductionCastIndex | undefined;
  if (touched) {
    idx = await loadCastIndexWith(tx, productionId);
    only = await relevantEventIds(tx, idx, productionId, touched);
  }
  const before = await snapshotUpcoming(tx, productionId, only, idx);
  const result = await fn(tx);
  if (before.length === 0) return { result, changes: [] };
  const afterList = await snapshotUpcoming(tx, productionId, only);
  const afterById = new Map(afterList.map((s) => [s.event.id, s]));
  const changes: (typeof eventChanges.$inferSelect)[] = [];
  for (const b of before) {
    const a = afterById.get(b.event.id);
    if (!a || Object.keys(describePersonImpact(b, a)).length === 0) continue;
    const [row] = await tx
      .update(events)
      .set({ revision: sql`${events.revision} + 1`, changedAt: new Date(), changeNote: "Who's called changed — check your call" })
      .where(eq(events.id, b.event.id))
      .returning();
    a.event = row;
    const change = await recordEventChange(tx, { before: b, after: a, changedByUserId: actorUserId });
    if (change) changes.push(change);
  }
  return { result, changes };
}

function callText(c: PersonCallSnap, tz: string, withDay: boolean) {
  const range = fmtRange(new Date(c.callAt), new Date(c.releaseAt), tz);
  return withDay ? `${fmtDay(new Date(c.callAt), tz)} ${range}` : range;
}

/**
 * What changed for each person: personId → summary. Includes everyone whose call moved, who was
 * added or removed, whose rehearsal content changed, and — for location changes, cancellations
 * and reinstatements — everyone called.
 */
export function describePersonImpact(before: EventSnapshot, after: EventSnapshot): Record<string, string> {
  const tz = after.tz;
  const out: Record<string, string> = {};
  const a = before.event;
  const b = after.event;
  const everyone = new Set([...Object.keys(before.calls), ...Object.keys(after.calls)]);

  if (a.status !== "draft" && b.status === "draft") {
    for (const pid of Object.keys(before.calls)) out[pid] = "Removed from the schedule";
    return out;
  }
  const republished = a.status === "draft" && b.status === "published";
  if (a.status !== "cancelled" && b.status === "cancelled") {
    // Cancel flows (web + MCP) set changeNote to the reason or null, so it's current.
    const reason = b.changeNote ? ` — ${b.changeNote.trim()}` : "";
    for (const pid of Object.keys(before.calls)) out[pid] = `Cancelled${reason}`;
    return out;
  }
  const reinstated = (a.status === "cancelled" || republished) && b.status === "published";

  for (const pid of everyone) {
    const was = before.calls[pid];
    const now = after.calls[pid];
    const parts: string[] = [];
    if (was && !now) parts.push(`No longer called (was ${callText(was, tz, false)})`);
    else if (!was && now) parts.push(`${republished ? "Back on the schedule — called" : "Now called"} ${callText(now, tz, true)}`);
    else if (was && now) {
      if (was.callAt !== now.callAt || was.releaseAt !== now.releaseAt) {
        const dayMoved = dayKey(new Date(was.callAt), tz) !== dayKey(new Date(now.callAt), tz);
        parts.push(`Now called ${callText(now, tz, dayMoved)} (was ${callText(was, tz, dayMoved)})`);
      } else if (reinstated) parts.push(`${republished ? "Back on the schedule" : "Back on"} — called ${callText(now, tz, false)}`);
      const added = now.reasons.filter((r) => !was.reasons.includes(r));
      const dropped = was.reasons.filter((r) => !now.reasons.includes(r));
      const IND = "person";
      const text = (k: string) => (k.startsWith("title:") ? k.slice(6) : after.labels[k] ?? before.labels[k] ?? "a scene");
      const addedR = added.filter((r) => r !== IND).map(text);
      const droppedR = dropped.filter((r) => r !== IND).map(text);
      if (addedR.length) parts.push(`now rehearsing ${addedR.join(", ")}`);
      if (added.includes(IND)) parts.push("now also called individually");
      if (droppedR.length) parts.push(`no longer ${droppedR.join(", ")}`);
      if (dropped.includes(IND)) parts.push("no longer called individually");
      const roomsNow = [...now.rooms].sort().join(", ");
      if (roomsNow !== [...was.rooms].sort().join(", ")) parts.push(roomsNow ? `room now ${roomsNow}` : "room changed");
    }
    if (now && (a.location ?? "") !== (b.location ?? "")) parts.push(b.location ? `location now ${b.location}` : "location changed");
    if (now && a.kind !== b.kind) parts.push(`now a ${b.kind}`);
    if (republished && parts.length && !/^back on/i.test(parts[0]) && !(was && !now)) parts.unshift("Back on the schedule");
    if (parts.length) out[pid] = parts.join("; ").replace(/^./, (ch) => ch.toUpperCase());
  }
  return out;
}

/** Event-level human summary (for the team and as a fallback); "" when nothing material. */
export function describeEventChange(before: EventSnapshot, after: EventSnapshot): string {
  const tz = after.tz;
  const a = before.event;
  const b = after.event;
  const parts: string[] = [];

  if (a.status !== b.status) {
    if (b.status === "draft") return "Removed from the schedule (unpublished)";
    if (a.status === "draft" && b.status === "published") parts.push("Back on the schedule");
    if (b.status === "cancelled") {
      // Cancel flows put the reason in events.changeNote.
      const reason = b.changeNote?.trim() ?? "";
      return reason ? `Cancelled — ${reason}` : "Cancelled";
    }
    if (a.status === "cancelled" && b.status === "published") parts.push("Back on (no longer cancelled)");
  }

  const sameDay = dayKey(a.startsAt, tz) === dayKey(b.startsAt, tz);
  if (!sameDay) {
    parts.push(`Moved from ${fmtDay(a.startsAt, tz)} ${fmtTime(a.startsAt, tz)} to ${fmtDay(b.startsAt, tz)} ${fmtTime(b.startsAt, tz)}`);
  } else {
    if (a.startsAt.getTime() !== b.startsAt.getTime())
      parts.push(`Start moved ${fmtTime(a.startsAt, tz)} → ${fmtTime(b.startsAt, tz)}`);
    if (a.endsAt.getTime() !== b.endsAt.getTime()) parts.push(`End moved ${fmtTime(a.endsAt, tz)} → ${fmtTime(b.endsAt, tz)}`);
  }
  if ((a.location ?? "") !== (b.location ?? "")) parts.push(b.location ? `Location now ${b.location}` : "Location removed");
  if (a.kind !== b.kind) parts.push(`Now a ${b.kind}`);

  const label = (k: string) => after.labels[k] ?? before.labels[k] ?? "someone";
  const callsOf = (s: EventSnapshot) => new Set(s.blocks.flatMap((bl) => bl.calls.map(key)));
  const was = callsOf(before);
  const now = callsOf(after);
  const added = [...now].filter((k) => !was.has(k)).map(label);
  const removed = [...was].filter((k) => !now.has(k)).map(label);
  if (added.length) parts.push(`${added.join(", ")} added`);
  if (removed.length) parts.push(`${removed.join(", ")} removed`);
  if (!added.length && !removed.length) {
    // Relative to the event start, so moving the whole event doesn't also report this.
    const shape = (s: EventSnapshot) => {
      const t0 = s.event.startsAt.getTime();
      return JSON.stringify(
        s.blocks.map((bl) => [bl.startsAt.getTime() - t0, bl.endsAt.getTime() - t0, bl.calls.map(key).sort()]).sort(),
      );
    };
    if (shape(before) !== shape(after)) parts.push("Times within the rehearsal changed");
  }
  const rooms = (s: EventSnapshot) => [...new Set(s.blocks.map((bl) => bl.location).filter(Boolean))].sort().join("|");
  if (rooms(before) !== rooms(after)) parts.push("Rooms changed");
  return parts.join("; ");
}

/** True when families would notice: the event-level diff or anyone's own call changed. */
export function isMaterialChange(before: EventSnapshot, after: EventSnapshot) {
  return describeEventChange(before, after) !== "" || Object.keys(describePersonImpact(before, after)).length > 0;
}

/**
 * Record a change if the event was already visible to families. Returns the row, or null when
 * nothing material changed or the event was a draft before. Call inside the mutation's
 * transaction, after bumping events.revision. Rows may have no affected people (a reshuffle that
 * moves nobody's call) — kept for the team's history, never shown to families.
 */
export async function recordEventChange(
  q: DbOrTx,
  opts: {
    before: EventSnapshot | null;
    after: EventSnapshot | null;
    changedByUserId?: string | null;
    /** The team's own explanation, appended in quotes. */
    note?: string | null;
  },
) {
  const { before, after } = opts;
  if (!before || !after) return null;
  // Families could see it before, or it's coming back after an unpublish. A first publish isn't a
  // "change" (notifyEventPublished covers it); edits made while unpublished aren't either.
  const visibleBefore = before.event.status !== "draft";
  const republish = before.event.status === "draft" && !!before.event.publishedAt && after.event.status === "published";
  if (!visibleBefore && !republish) return null;
  const diff = describeEventChange(before, after);
  const personSummaries = describePersonImpact(before, after);
  if (!diff && Object.keys(personSummaries).length === 0) return null;
  const note = opts.note?.trim();
  const base = diff || "Cast or scene changes affected who's called";
  const summary = note && !base.includes(note) ? `${base} — “${note}”` : base;
  const [row] = await q
    .insert(eventChanges)
    .values({
      eventId: after.event.id,
      productionId: after.event.productionId,
      revision: after.event.revision,
      summary,
      affectedPersonIds: Object.keys(personSummaries),
      personSummaries,
      changedByUserId: opts.changedByUserId ?? null,
    })
    .returning();
  return row;
}

/* ───────────────────────── Reading changes for a family ───────────────────────── */

export type FamilyChange = {
  event: EventRow;
  production: typeof productions.$inferSelect;
  /** First names of covered people this event's changes affected, e.g. ["Maya"]. */
  people: string[];
  latestRevision: number;
  acknowledged: boolean;
  /** Oldest first. `lines` are per covered person ("Maya: Now called 5:30–7:00 PM (was 6:00–7:30 PM)"). */
  changes: { revision: number; summary: string; lines: string[]; createdAt: Date }[];
  /** The team's own "what changed" words for the latest change shown, or null (see teamNote). */
  teamNote: string | null;
};

/** What withCallImpact writes to events.changeNote when a cast/scene edit moves calls: generated, not the team's words. */
export const GENERIC_CHANGE_NOTE = "Who's called changed — check your call";

/**
 * The team's own explanation of a change, for families — or null. events.changeNote holds the latest
 * note, but save flows also fill it with the generated summary when the team typed nothing, so a
 * note counts only when recordEventChange quoted it in the change row's summary (`… — “note”`). A
 * cancel reason is never quoted there; the "Cancelled — reason" line already carries it.
 */
export function teamNote(event: { changeNote: string | null }, latest: { summary: string } | undefined | null): string | null {
  const note = event.changeNote?.trim();
  if (!note || note === GENERIC_CHANGE_NOTE || !latest) return null;
  return latest.summary.includes(`“${note}”`) ? note : null;
}

/** The team's note for an event's latest change, read from the change rows (for pages without a FamilyChange). */
export async function getTeamNoteForEvent(event: { id: string; changeNote: string | null }): Promise<string | null> {
  const note = event.changeNote?.trim();
  if (!note || note === GENERIC_CHANGE_NOTE) return null;
  const [latest] = await db
    .select({ summary: eventChanges.summary })
    .from(eventChanges)
    .where(eq(eventChanges.eventId, event.id))
    .orderBy(desc(eventChanges.revision), desc(eventChanges.createdAt))
    .limit(1);
  return teamNote(event, latest);
}

/**
 * Why a cancelled event was cancelled, in the team's words, or null. Cancel flows put the reason in
 * events.changeNote, but the web flow stores the bare generated summary ("Cancelled") when no reason
 * was given, and never-changed rows may hold the generic cast-change text.
 */
export function cancelReason(event: { status: string; changeNote: string | null }): string | null {
  if (event.status !== "cancelled") return null;
  const note = event.changeNote?.trim().replace(/^cancelled(\s*[—–-]\s*|$)/i, "").trim();
  return note && note !== GENERIC_CHANGE_NOTE ? note : null;
}

/**
 * Changes that affect anyone this user covers, grouped by event. Only events that haven't ended
 * before `eventsEndingAfter` (default: 1 day ago), only published/cancelled events, and only
 * change rows created at/after `createdSince` when given.
 */
export async function getChangesForUser(
  userId: string,
  opts: { createdSince?: Date; eventsEndingAfter?: Date; includeAcknowledged?: boolean } = {},
): Promise<FamilyChange[]> {
  const covered = await getCoveredPersonIds(userId);
  if (covered.length === 0) return [];
  const coveredSet = new Set(covered);
  const conds = [
    sql`${eventChanges.affectedPersonIds} ?| array[${sql.join(covered.map((id) => sql`${id}`), sql`, `)}]::text[]`,
    gte(events.endsAt, opts.eventsEndingAfter ?? new Date(Date.now() - 86400_000)),
  ];
  if (opts.createdSince) conds.push(gte(eventChanges.createdAt, opts.createdSince));
  const rows = await db
    .select({ change: eventChanges, event: events, production: productions })
    .from(eventChanges)
    .innerJoin(events, eq(events.id, eventChanges.eventId))
    .innerJoin(productions, eq(productions.id, events.productionId))
    .where(and(...conds))
    .orderBy(asc(eventChanges.revision), asc(eventChanges.createdAt));
  if (rows.length === 0) return [];

  const eventIds = [...new Set(rows.map((r) => r.event.id))];
  const ackRows = await db
    .select()
    .from(changeAcks)
    .where(and(eq(changeAcks.userId, userId), inArray(changeAcks.eventId, eventIds)));
  const acked = new Map(ackRows.map((r) => [r.eventId, r.revision]));
  const personRows = await db.select({ id: people.id, firstName: people.firstName }).from(people).where(inArray(people.id, covered));
  const firstName = new Map(personRows.map((p) => [p.id, p.firstName]));
  const multi = new Set(rows.flatMap((r) => r.change.affectedPersonIds.filter((id) => coveredSet.has(id)))).size > 1;

  const byEvent = new Map<string, FamilyChange>();
  for (const { change, event, production } of rows) {
    // An unpublished event shows only its "Removed from the schedule" entry, nothing older.
    if (event.status === "draft" && change.revision !== event.revision) continue;
    const mine = change.affectedPersonIds.filter((id) => coveredSet.has(id));
    const lines = mine.map((id) => {
      const text = change.personSummaries[id] ?? change.summary;
      return multi || mine.length > 1 ? `${firstName.get(id) ?? "Someone"}: ${text}` : text;
    });
    const entry =
      byEvent.get(event.id) ??
      ({ event, production, people: [], latestRevision: 0, acknowledged: true, changes: [], teamNote: null } satisfies FamilyChange);
    entry.latestRevision = Math.max(entry.latestRevision, change.revision);
    const seen = (acked.get(event.id) ?? -1) >= change.revision;
    if (!seen) entry.acknowledged = false;
    if (opts.includeAcknowledged || !seen) {
      entry.changes.push({ revision: change.revision, summary: change.summary, lines, createdAt: change.createdAt });
      // Names only from the changes actually shown (not ones already acknowledged).
      entry.people = [...new Set([...entry.people, ...mine.map((id) => firstName.get(id) ?? "Someone")])];
    }
    byEvent.set(event.id, entry);
  }
  const out = [...byEvent.values()].filter((e) => e.changes.length > 0);
  for (const e of out) e.teamNote = teamNote(e.event, e.changes.at(-1));
  return out.sort((x, y) => x.event.startsAt.getTime() - y.event.startsAt.getTime());
}

/** Changes affecting this user's people that they haven't acknowledged ("Got it"). */
export async function getUnacknowledgedChanges(userId: string, opts: { since?: Date } = {}) {
  return getChangesForUser(userId, { eventsEndingAfter: opts.since });
}
export type UnackedChange = FamilyChange;

/**
 * Mark an event's changes as seen up to `revision` (never moves backwards). The caller must have
 * checked the user may see this event (e.g. it's in getUnacknowledgedChanges / their calls).
 */
export async function acknowledge(userId: string, eventId: string, revision: number) {
  await db
    .insert(changeAcks)
    .values({ userId, eventId, revision, ackedAt: new Date() })
    .onConflictDoUpdate({
      target: [changeAcks.userId, changeAcks.eventId],
      set: { revision, ackedAt: new Date() },
      setWhere: lt(changeAcks.revision, revision),
    });
}

/* ───────────────────────── Team view ───────────────────────── */

export type AckStatusRow = {
  personId: string;
  name: string;
  /** Latest change that affected this person, or null if no change affected them. */
  change: { revision: number; summary: string } | null;
  /** Accounts that receive this person's calls (their own and/or guardians'). */
  accounts: { userId: string; name: string; ackedRevision: number | null }[];
  /** Nothing to see, or at least one of those accounts acknowledged `change.revision`. */
  seen: boolean;
  /** False when nobody linked to this person has an account — they can't see changes in-app. */
  reachable: boolean;
};

/**
 * For the creative team: everyone a change to this event affected, and whether their family has
 * seen the latest change that affected them. People no change touched aren't listed.
 */
export async function getAckStatus(eventId: string) {
  const changeRows = await db
    .select()
    .from(eventChanges)
    .where(eq(eventChanges.eventId, eventId))
    .orderBy(desc(eventChanges.revision), desc(eventChanges.createdAt));
  const latest = changeRows[0] ?? null;
  // personId → latest change that affected them
  const latestFor = new Map<string, (typeof changeRows)[number]>();
  for (const c of changeRows) for (const pid of c.affectedPersonIds) if (!latestFor.has(pid)) latestFor.set(pid, c);
  const personIds = [...latestFor.keys()];
  if (personIds.length === 0) return { latestChange: latest, people: [] as AckStatusRow[], seenCount: 0, total: 0 };

  const personRows = await db.select().from(people).where(inArray(people.id, personIds));
  const guardianRows = await db
    .select({ minorId: guardianships.minorId, userId: people.userId })
    .from(guardianships)
    .innerJoin(people, eq(people.id, guardianships.guardianId))
    .where(inArray(guardianships.minorId, personIds));
  const accountsByPerson = new Map<string, Set<string>>();
  for (const p of personRows) accountsByPerson.set(p.id, new Set(p.userId ? [p.userId] : []));
  for (const g of guardianRows) if (g.userId) accountsByPerson.get(g.minorId)?.add(g.userId);

  const allUserIds = [...new Set([...accountsByPerson.values()].flatMap((s) => [...s]))];
  const userRows = allUserIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, allUserIds))
    : [];
  const ackRows = allUserIds.length
    ? await db.select().from(changeAcks).where(and(eq(changeAcks.eventId, eventId), inArray(changeAcks.userId, allUserIds)))
    : [];
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const ackBy = new Map(ackRows.map((a) => [a.userId, a.revision]));

  const rows: AckStatusRow[] = personRows.map((p) => {
    const c = latestFor.get(p.id)!;
    const accounts = [...(accountsByPerson.get(p.id) ?? [])].map((uid) => ({
      userId: uid,
      name: userName.get(uid) ?? "",
      ackedRevision: ackBy.get(uid) ?? null,
    }));
    return {
      personId: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      change: { revision: c.revision, summary: c.personSummaries[p.id] ?? c.summary },
      accounts,
      seen: accounts.some((a) => (a.ackedRevision ?? -1) >= c.revision),
      reachable: accounts.length > 0,
    };
  });
  rows.sort((x, y) => Number(x.seen) - Number(y.seen) || x.name.localeCompare(y.name));
  return { latestChange: latest, people: rows, seenCount: rows.filter((r) => r.seen).length, total: rows.length };
}

/* ───────────────────────── Push notifications ───────────────────────── */

/** personId → accounts that should hear about them (own login + guardians' logins). */
async function accountsFor(personIds: string[]) {
  const map = new Map<string, Set<string>>();
  if (personIds.length === 0) return map;
  const own = await db.select({ id: people.id, userId: people.userId }).from(people).where(inArray(people.id, personIds));
  const guardians = await db
    .select({ minorId: guardianships.minorId, userId: people.userId })
    .from(guardianships)
    .innerJoin(people, eq(people.id, guardianships.guardianId))
    .where(inArray(guardianships.minorId, personIds));
  for (const r of [...own.map((o) => ({ pid: o.id, uid: o.userId })), ...guardians.map((g) => ({ pid: g.minorId, uid: g.userId }))]) {
    if (!r.uid) continue;
    const set = map.get(r.uid) ?? new Set<string>();
    set.add(r.pid);
    map.set(r.uid, set);
  }
  return map; // userId → personIds they cover among the given ones
}

async function eventContext(eventId: string) {
  const [row] = await db
    .select({ event: events, production: productions, tz: organizations.timezone })
    .from(events)
    .innerJoin(productions, eq(productions.id, events.productionId))
    .innerJoin(organizations, eq(organizations.id, productions.orgId))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

const eventUrl = (e: EventRow) => `/p/${e.productionId}/schedule/${e.id}`;

/**
 * Run a notification job after the response is sent (next/server `after`), so pushes never block
 * the edit and never run inside a transaction. Outside a request (scripts), runs it detached.
 */
export function notifyAfterCommit(job: () => Promise<unknown>) {
  const safe = () => job().catch((e) => console.error("[changes] notify failed", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/** Schedule the push for a recorded change (null-safe). Call after the transaction commits. */
export function scheduleChangeNotification(change: typeof eventChanges.$inferSelect | null | undefined) {
  if (change && change.affectedPersonIds.length) notifyAfterCommit(() => notifyEventChange(change));
}

/** Schedule the "New rehearsal posted" push. Call after commit, on FIRST publish only. */
export function schedulePublishNotification(eventId: string) {
  notifyAfterCommit(() => notifyEventPublished(eventId));
}

const kindWord = (e: EventRow) => (e.title.trim().toLowerCase() === e.kind ? e.kind : e.title.trim());

/**
 * Push a recorded change to the families it affects — one notification per account, listing only
 * their own people ("Maya: Now called 6:30–8:00 PM (was 6:00–8:00 PM)"). Call AFTER the
 * transaction commits (never inside it). No-op without VAPID keys; never throws.
 */
export async function notifyEventChange(change: typeof eventChanges.$inferSelect | null | undefined) {
  if (!change || change.affectedPersonIds.length === 0) return { sent: 0, failed: 0, removed: 0 };
  try {
    const { sendPushToUsers } = await import("./push");
    const ctx = await eventContext(change.eventId);
    if (!ctx) return { sent: 0, failed: 0, removed: 0 };
    const byUser = await accountsFor(change.affectedPersonIds);
    const names = new Map(
      (await db.select({ id: people.id, firstName: people.firstName }).from(people).where(inArray(people.id, change.affectedPersonIds))).map(
        (p) => [p.id, p.firstName],
      ),
    );
    const day = fmtDay(ctx.event.startsAt, ctx.tz);
    const cancelled = ctx.event.status === "cancelled";
    const verb = cancelled ? "Cancelled" : ctx.event.status === "draft" ? "Removed" : "Changed";
    const title = `${verb}: ${day} ${kindWord(ctx.event)}`;
    const total = { sent: 0, failed: 0, removed: 0 };
    for (const [userId, pids] of byUser) {
      const lines = [...pids].map((pid) => `${names.get(pid) ?? "Someone"}: ${change.personSummaries[pid] ?? change.summary}`);
      // Families can't open an unpublished event (404), so a "Removed" push lands on My Calls.
      const url = ctx.event.status === "draft" ? "/home" : eventUrl(ctx.event);
      const r = await sendPushToUsers([userId], { title, body: lines.join("\n"), url, tag: `event-${change.eventId}` });
      total.sent += r.sent;
      total.failed += r.failed;
      total.removed += r.removed;
    }
    return total;
  } catch (e) {
    console.error("[changes] push failed", e);
    return { sent: 0, failed: 0, removed: 0 };
  }
}

/**
 * Push a newly published event to everyone it calls ("Maya called 6:15–8:00 PM · Hall B"), one
 * notification per account. Call after commit, only on FIRST publish. Never throws.
 */
export async function notifyEventPublished(eventId: string) {
  try {
    const { sendPushToUsers } = await import("./push");
    const ctx = await eventContext(eventId);
    const sheet = await getEventCallSheet(eventId);
    if (!ctx || !sheet || sheet.calls.size === 0) return { sent: 0, failed: 0, removed: 0 };
    const byUser = await accountsFor([...sheet.calls.keys()]);
    const title = `New ${kindWord(ctx.event)} posted`;
    const day = fmtDay(ctx.event.startsAt, ctx.tz);
    const where = ctx.event.location ? ` · ${ctx.event.location}` : "";
    const total = { sent: 0, failed: 0, removed: 0 };
    for (const [userId, pids] of byUser) {
      const lines = [...pids].map((pid) => {
        const c = sheet.calls.get(pid)!;
        return `${sheet.people.get(pid)?.firstName ?? "Someone"} called ${fmtRange(c.callAt, c.releaseAt, ctx.tz)}`;
      });
      const r = await sendPushToUsers([userId], { title, body: `${day} · ${lines.join(", ")}${where}`, url: eventUrl(ctx.event), tag: `event-${eventId}` });
      total.sent += r.sent;
      total.failed += r.failed;
      total.removed += r.removed;
    }
    return total;
  } catch (e) {
    console.error("[changes] push failed", e);
    return { sent: 0, failed: 0, removed: 0 };
  }
}
