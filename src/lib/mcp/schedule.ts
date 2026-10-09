import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { blockCalls, conflicts, eventBlocks, events, people, productions, roleAssignments, roles } from "@/db/schema";
import { buildCallSheets, getCallsForPeople, getEventCallSheet, loadCastIndex } from "@/lib/calls";
import {
  isMaterialChange,
  recordEventChange,
  scheduleChangeNotification,
  schedulePublishNotification,
  snapshotEvent,
} from "@/lib/changes";
import { fmtRange, toLocalInput } from "@/lib/time";
import { loadGroups, loadRoles, loadScenes, requireRoles, requireScene } from "./production";
import {
  type Ctx,
  type Q,
  fail,
  getProduction,
  isUuid,
  listForError,
  loadOrgPeople,
  local,
  norm,
  parseTime,
  personName,
  resolvePerson,
} from "./util";

/* ───────────────────────── Schemas ───────────────────────── */

const timeArg = z
  .string()
  .describe("Org-local wall clock \"YYYY-MM-DDTHH:mm\" (preferred) or ISO 8601 with offset, e.g. \"2026-10-07T18:00\"");

export const callInput = z.object({
  type: z
    .enum(["scene", "role", "group", "person", "all_cast"])
    .describe(
      "scene = everyone whose role is in the scene (primary + swing, not understudies); role = everyone assigned to the role incl. understudies; group = every role in the group; person = one person; all_cast = everyone cast in the production",
    ),
  ref: z
    .string()
    .optional()
    .describe("Name or id of the scene/role/group/person. Scenes also accept \"Act 1 Sc 3\". Omit for all_cast."),
});

export const blockInput = z.object({
  start: timeArg,
  end: timeArg,
  title: z.string().max(4000).nullish().describe("Optional label, e.g. \"Choreography: Act 1 finale\". Defaults to what's called."),
  leader: z.string().max(4000).nullish().describe("Who runs this block, e.g. \"Choreographer\", \"Music Director\""),
  location: z.string().max(4000).nullish().describe("Room, if different from the event location"),
  notes: z.string().max(4000).nullish(),
  calls: z.array(callInput).min(1).describe("Who is called to this block"),
});
export type BlockInput = z.infer<typeof blockInput>;

export const eventKinds = ["rehearsal", "performance", "tech", "dress", "fitting", "meeting", "other"] as const;

/* ───────────────────────── Helpers ───────────────────────── */

type EventRow = typeof events.$inferSelect;

/** Load an event and make sure it belongs to the caller's org. */
export async function getEvent(ctx: Ctx, id: string, q: Q = db) {
  if (!isUuid(id)) fail(`Event ids are UUIDs; got "${id}". Use list_events to find ids.`);
  const rows = await q
    .select({ event: events, production: productions })
    .from(events)
    .innerJoin(productions, eq(productions.id, events.productionId))
    .where(and(eq(events.id, id), eq(productions.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? fail(`No event ${id} in ${ctx.orgName}.`);
}

/** Resolve block call refs to (target, targetId) rows; all lookups are scoped to the production. */
async function resolveBlocks(ctx: Ctx, productionId: string, blocks: BlockInput[], q: Q) {
  // Sequential: this runs inside transactions, where everything must go through one client in order.
  const roleRows = await loadRoles(productionId, q);
  const sceneRows = await loadScenes(productionId, q);
  const groupRows = await loadGroups(productionId, q);
  const personRows = await loadOrgPeople(ctx, q);
  return blocks.map((b, i) => {
    const start = parseTime(b.start, ctx.timezone, `blocks[${i}].start`);
    const end = parseTime(b.end, ctx.timezone, `blocks[${i}].end`);
    if (end <= start) fail(`blocks[${i}]: end must be after start.`);
    const calls = b.calls.map((c) => {
      if (c.type === "all_cast") return { target: "all_cast" as const, targetId: null };
      const ref = c.ref?.trim() || fail(`blocks[${i}]: a ${c.type} call needs \`ref\`.`);
      switch (c.type) {
        case "scene":
          return { target: "scene" as const, targetId: requireScene(sceneRows, ref).id };
        case "role":
          return { target: "role" as const, targetId: requireRoles(roleRows, [ref], `blocks[${i}]`)[0].id };
        case "group": {
          const g = isUuid(ref) ? groupRows.find((x) => x.id === ref) : groupRows.find((x) => norm(x.name) === norm(ref));
          if (!g) fail(`blocks[${i}]: unknown group "${ref}". Groups: ${listForError(groupRows.map((x) => x.name)) || "(none)"}`);
          return { target: "group" as const, targetId: g!.id };
        }
        case "person":
          return { target: "person" as const, targetId: resolvePerson(personRows, ref).id };
      }
    });
    return { ...b, start, end, calls };
  });
}

async function writeBlocks(eventId: string, blocks: Awaited<ReturnType<typeof resolveBlocks>>, q: Q) {
  await q.delete(eventBlocks).where(eq(eventBlocks.eventId, eventId));
  for (const [i, b] of blocks.entries()) {
    const [blk] = await q
      .insert(eventBlocks)
      .values({
        eventId,
        startsAt: b.start,
        endsAt: b.end,
        title: b.title ?? null,
        leader: b.leader ?? null,
        location: b.location ?? null,
        notes: b.notes ?? null,
        sortOrder: i,
      })
      .returning();
    await q.insert(blockCalls).values(b.calls.map((c) => ({ blockId: blk.id, ...c })));
  }
}

type BlockLike = {
  start: Date;
  end: Date;
  title?: string | null;
  leader?: string | null;
  location?: string | null;
  notes?: string | null;
  calls: { target: string; targetId: string | null }[];
};

function signatureOf(blocks: BlockLike[]) {
  return JSON.stringify(
    blocks.map((b) => [
      b.start.getTime(),
      b.end.getTime(),
      b.title ?? null,
      b.leader ?? null,
      b.location ?? null,
      b.notes ?? null,
      b.calls.map((c) => `${c.target}:${c.targetId ?? ""}`).sort(),
    ]),
  );
}

async function blocksSignature(eventId: string, q: Q) {
  const rows = await q
    .select()
    .from(eventBlocks)
    .where(eq(eventBlocks.eventId, eventId))
    .orderBy(asc(eventBlocks.sortOrder));
  const calls = rows.length
    ? await q.select().from(blockCalls).where(inArray(blockCalls.blockId, rows.map((r) => r.id)))
    : [];
  return signatureOf(
    rows.map((r) => ({
      start: r.startsAt,
      end: r.endsAt,
      title: r.title,
      leader: r.leader,
      location: r.location,
      notes: r.notes,
      calls: calls.filter((c) => c.blockId === r.id),
    })),
  );
}

const CANCEL_NOTE = /^Cancelled: [^\n]*(?:\n\n)?/;

/** Compact event summary with who's called (counts) for list output. */
async function summarizeEvents(ctx: Ctx, productionId: string, rows: EventRow[]) {
  if (rows.length === 0) return [];
  const idx = await loadCastIndex(productionId);
  const sheets = await buildCallSheets(idx, rows);
  return sheets.map(({ event, blocks, calls }) => ({
    id: event.id,
    title: event.title,
    kind: event.kind,
    status: event.status,
    revision: event.revision,
    start: local(event.startsAt, ctx.timezone),
    end: local(event.endsAt, ctx.timezone),
    location: event.location ?? undefined,
    notes: event.notes ?? undefined,
    peopleCalled: calls.size,
    blocks: blocks.map((b) => ({
      time: fmtRange(b.startsAt, b.endsAt, ctx.timezone),
      title: b.title ?? undefined,
      leader: b.leader ?? undefined,
      calls: b.labels,
      peopleCalled: b.personIds.size,
    })),
  }));
}

/* ───────────────────────── Tools ───────────────────────── */

export async function listEvents(
  ctx: Ctx,
  opts: { production: string; from?: string; to?: string; includeDrafts?: boolean; status?: EventRow["status"] },
) {
  const p = await getProduction(ctx, opts.production);
  const conds = [eq(events.productionId, p.id)];
  if (opts.from) conds.push(gte(events.endsAt, parseTime(opts.from, ctx.timezone, "from")));
  if (opts.to) conds.push(lte(events.startsAt, parseTime(opts.to, ctx.timezone, "to")));
  if (opts.status) conds.push(eq(events.status, opts.status));
  let rows = await db.select().from(events).where(and(...conds)).orderBy(asc(events.startsAt));
  if (opts.includeDrafts === false) rows = rows.filter((e) => e.status !== "draft");
  const truncated = rows.length > 100;
  rows = rows.slice(0, 100);
  return { production: p.title, timezone: ctx.timezone, truncated, events: await summarizeEvents(ctx, p.id, rows) };
}

export async function createEvent(
  ctx: Ctx,
  input: {
    production: string;
    title: string;
    kind?: EventRow["kind"];
    start?: string;
    end?: string;
    location?: string | null;
    notes?: string | null;
    publish?: boolean;
    blocks: BlockInput[];
  },
) {
  const p = await getProduction(ctx, input.production);
  return db.transaction(async (tx) => {
    const blocks = await resolveBlocks(ctx, p.id, input.blocks, tx);
    const start = input.start
      ? parseTime(input.start, ctx.timezone, "start")
      : blocks.length
        ? new Date(Math.min(...blocks.map((b) => b.start.getTime())))
        : fail("Give `start`/`end` or at least one block.");
    const end = input.end
      ? parseTime(input.end, ctx.timezone, "end")
      : blocks.length
        ? new Date(Math.max(...blocks.map((b) => b.end.getTime())))
        : fail("Give `end`.");
    if (end <= start) fail("end must be after start.");
    assertBlocksWithin(blocks, start, end);
    const [ev] = await tx
      .insert(events)
      .values({
        productionId: p.id,
        kind: input.kind ?? "rehearsal",
        title: input.title.trim(),
        startsAt: start,
        endsAt: end,
        location: input.location ?? p.defaultLocation,
        notes: input.notes ?? null,
        status: input.publish ? "published" : "draft",
        publishedAt: input.publish ? new Date() : null,
      })
      .returning();
    await writeBlocks(ev.id, blocks, tx);
    return ev;
  }).then(async (ev) => {
    if (ev.status === "published") schedulePublishNotification(ev.id); // runs after the response
    return (await summarizeEvents(ctx, p.id, [ev]))[0];
  });
}

/** Blocks outside the event's own times would give families calls the schedule never shows. */
function assertBlocksWithin(blocks: { start: Date; end: Date }[], start: Date, end: Date) {
  const bad = blocks.find((b) => b.start < start || b.end > end);
  if (bad) fail(`Block ${toLocalInput(bad.start, "UTC")}Z–${toLocalInput(bad.end, "UTC")}Z falls outside the event (${start.toISOString()}–${end.toISOString()}). Widen start/end or move the block.`);
}

export async function updateEvent(
  ctx: Ctx,
  input: {
    event: string;
    title?: string;
    kind?: EventRow["kind"];
    start?: string;
    end?: string;
    location?: string | null;
    notes?: string | null;
    blocks?: BlockInput[];
    changeNote?: string | null;
  },
) {
  const { event: initial, production } = await getEvent(ctx, input.event);
  const updated = await db.transaction(async (tx) => {
    let change: Awaited<ReturnType<typeof recordEventChange>> = null;
    // Lock the row so concurrent edits serialize and each gets its own revision.
    const [event] = await tx.select().from(events).where(eq(events.id, initial.id)).for("update");
    const before = await snapshotEvent(tx, event.id);
    const set: Partial<EventRow> = {};
    let blocks: Awaited<ReturnType<typeof resolveBlocks>> | null = null;
    if (input.blocks) {
      blocks = await resolveBlocks(ctx, production.id, input.blocks, tx);
      if ((await blocksSignature(event.id, tx)) !== signatureOf(blocks)) await writeBlocks(event.id, blocks, tx);
    }
    if (input.title !== undefined && input.title.trim() !== event.title) set.title = input.title.trim();
    if (input.notes !== undefined && (input.notes ?? null) !== event.notes) set.notes = input.notes ?? null;
    if (input.kind && input.kind !== event.kind) set.kind = input.kind;
    if (input.location !== undefined && (input.location ?? null) !== event.location) set.location = input.location ?? null;
    let start = input.start ? parseTime(input.start, ctx.timezone, "start") : null;
    let end = input.end ? parseTime(input.end, ctx.timezone, "end") : null;
    if (blocks?.length) {
      // Without explicit times, only widen the envelope so it still contains every block — never
      // shrink a published rehearsal to the blocks (families would be told the start moved).
      const first = Math.min(...blocks.map((b) => b.start.getTime()));
      const last = Math.max(...blocks.map((b) => b.end.getTime()));
      start ??= new Date(Math.min(event.startsAt.getTime(), first));
      end ??= new Date(Math.max(event.endsAt.getTime(), last));
    }
    if (start && start.getTime() !== event.startsAt.getTime()) set.startsAt = start;
    if (end && end.getTime() !== event.endsAt.getTime()) set.endsAt = end;
    if ((set.endsAt ?? event.endsAt) <= (set.startsAt ?? event.startsAt)) fail("end must be after start.");
    if (blocks) assertBlocksWithin(blocks, set.startsAt ?? event.startsAt, set.endsAt ?? event.endsAt);
    let [row] = Object.keys(set).length ? await tx.update(events).set(set).where(eq(events.id, event.id)).returning() : [event];

    // Material = something families would notice (event diff or anyone's own call). Block notes or
    // leader edits, title/notes tweaks: saved, but no revision bump or change entry.
    const after = await snapshotEvent(tx, event.id);
    if (event.status !== "draft" && before && after && isMaterialChange(before, after)) {
      const note = input.changeNote?.trim() || null;
      [row] = await tx
        .update(events)
        .set({ revision: sql`${events.revision} + 1`, changedAt: new Date() })
        .where(eq(events.id, event.id))
        .returning();
      after.event = row;
      change = await recordEventChange(tx, { before, after, changedByUserId: ctx.userId, note });
      // Families see events.changeNote next to the "Updated" badge: the team's words, else the diff.
      const changeNote = (note ?? change?.summary)?.slice(0, 300);
      if (changeNote) [row] = await tx.update(events).set({ changeNote }).where(eq(events.id, event.id)).returning();
    }
    return { row, previousRevision: event.revision, change };
  });
  scheduleChangeNotification(updated.change); // runs after the response
  return {
    revisionBumped: updated.row.revision !== updated.previousRevision,
    event: (await summarizeEvents(ctx, production.id, [updated.row]))[0],
  };
}

export async function publishEvents(
  ctx: Ctx,
  input: { events?: string[]; production?: string; from?: string; to?: string },
  q: Q = db,
) {
  let targets: EventRow[] = [];
  if (input.events?.length) {
    for (const id of input.events) targets.push((await getEvent(ctx, id, q)).event);
  } else if (input.production) {
    const p = await getProduction(ctx, input.production, q);
    const conds = [eq(events.productionId, p.id), eq(events.status, "draft")];
    if (input.from) conds.push(gte(events.startsAt, parseTime(input.from, ctx.timezone, "from")));
    if (input.to) conds.push(lte(events.startsAt, parseTime(input.to, ctx.timezone, "to")));
    targets = await q.select().from(events).where(and(...conds));
  } else fail("Pass `events` (ids) or `production` (publishes all its drafts, optionally within from/to).");

  const published: { id: string; title: string; start: string | null; wasCancelled?: boolean }[] = [];
  // Push notifications must go out after the caller's transaction commits; returned for that.
  const afterCommit: (() => void)[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const t of targets) {
    // Re-read under a row lock (callers run this in a transaction) so revisions don't collide.
    const [e] = await q.select().from(events).where(eq(events.id, t.id)).for("update");
    if (e.status === "published") {
      skipped.push({ id: e.id, reason: "already published" });
      continue;
    }
    // Reinstating a cancellation or re-publishing something families saw before is a change.
    const before = e.status === "cancelled" || e.publishedAt ? await snapshotEvent(q, e.id) : null;
    await q
      .update(events)
      .set({
        status: "published",
        publishedAt: e.publishedAt ?? new Date(),
        // Drop a legacy "Cancelled: <reason>" line older cancel_event versions added to notes.
        notes: e.status === "cancelled" ? e.notes?.replace(CANCEL_NOTE, "") || null : e.notes,
        // Reinstating a cancelled event is a change families must see.
        ...(e.status === "cancelled"
          ? { revision: sql`${events.revision} + 1`, changedAt: new Date(), changeNote: "Back on — no longer cancelled" }
          : // Re-publishing something families already saw (then unpublished) is a change too, like the web flow.
            e.publishedAt
            ? { revision: sql`${events.revision} + 1`, changedAt: new Date(), changeNote: "Back on the schedule" }
            : {}),
      })
      .where(eq(events.id, e.id));
    if (before) {
      const change = await recordEventChange(q, { before, after: await snapshotEvent(q, e.id), changedByUserId: ctx.userId });
      afterCommit.push(() => scheduleChangeNotification(change));
    } else if (!e.publishedAt) afterCommit.push(() => schedulePublishNotification(e.id)); // first publish
    published.push({ id: e.id, title: e.title, start: local(e.startsAt, ctx.timezone), wasCancelled: e.status === "cancelled" || undefined });
  }
  return { published, skipped, afterCommit };
}

export async function cancelEvent(ctx: Ctx, id: string, reason?: string | null) {
  const { event } = await getEvent(ctx, id);
  if (event.status === "cancelled") return { id, status: "cancelled", note: "already cancelled" };
  // Cancelling a draft would put it in front of families for the first time (as cancelled).
  if (event.status === "draft") fail("Drafts aren't visible to families — delete it instead (delete_event), or publish it first.");
  let change: Awaited<ReturnType<typeof recordEventChange>> = null;
  const row = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(events).where(eq(events.id, event.id)).for("update");
    if (locked.status === "cancelled") return locked;
    if (locked.status === "draft") fail("Drafts aren't visible to families — delete it instead.");
    const before = await snapshotEvent(tx, event.id);
    const wasVisible = locked.status === "published";
    const [r] = await tx
      .update(events)
      .set({
        status: "cancelled",
        // Same convention as the schedule screens: the reason lives in changeNote.
        changeNote: reason?.trim().slice(0, 300) || null,
        ...(wasVisible ? { revision: sql`${events.revision} + 1`, changedAt: new Date() } : {}),
      })
      .where(eq(events.id, event.id))
      .returning();
    change = await recordEventChange(tx, { before, after: await snapshotEvent(tx, event.id), changedByUserId: ctx.userId });
    return r;
  });
  scheduleChangeNotification(change); // runs after the response
  return { id: row.id, title: row.title, status: row.status, revision: row.revision };
}

export async function deleteEvent(ctx: Ctx, id: string) {
  const { event } = await getEvent(ctx, id);
  // Families must see cancellations: anything they could see is cancelled, never deleted.
  if (event.status !== "draft") fail("Published events can't be deleted — use cancel_event so families see it's off.");
  await db.delete(events).where(eq(events.id, event.id));
  return { deleted: event.id, title: event.title, wasStatus: event.status };
}

export async function callSheet(ctx: Ctx, id: string) {
  await getEvent(ctx, id); // org check
  const sheet = (await getEventCallSheet(id))!;
  const tz = ctx.timezone;
  const rows = [...sheet.calls.values()]
    .map((c) => ({ c, p: sheet.people.get(c.personId) }))
    .sort((a, b) => a.c.callAt.getTime() - b.c.callAt.getTime() || personName(a.p!).localeCompare(personName(b.p!)));
  return {
    event: {
      id: sheet.event.id,
      title: sheet.event.title,
      status: sheet.event.status,
      revision: sheet.event.revision,
      start: local(sheet.event.startsAt, tz),
      end: local(sheet.event.endsAt, tz),
      location: sheet.event.location ?? undefined,
    },
    timezone: tz,
    blocks: sheet.blocks.map((b) => ({
      time: fmtRange(b.startsAt, b.endsAt, tz),
      title: b.title ?? undefined,
      leader: b.leader ?? undefined,
      calls: b.labels,
    })),
    people: rows.map(({ c, p }) => ({
      personId: c.personId,
      name: p ? personName(p) : c.personId,
      call: local(c.callAt, tz),
      release: local(c.releaseAt, tz),
      display: fmtRange(c.callAt, c.releaseAt, tz),
      reasons: c.reasons,
    })),
  };
}

export async function personSchedule(ctx: Ctx, input: { person: string; from?: string; to?: string; includeDrafts?: boolean }) {
  const person = resolvePerson(await loadOrgPeople(ctx), input.person);
  const from = input.from ? parseTime(input.from, ctx.timezone, "from") : new Date();
  const to = input.to ? parseTime(input.to, ctx.timezone, "to") : undefined;
  const calls = await getCallsForPeople([person.id], { from, to, includeDrafts: input.includeDrafts });
  return {
    person: personName(person),
    timezone: ctx.timezone,
    calls: calls
      .filter((c) => c.production.orgId === ctx.orgId)
      .slice(0, 100)
      .map((c) => ({
        eventId: c.event.id,
        production: c.production.title,
        event: c.event.title,
        status: c.event.status,
        call: local(c.callAt, ctx.timezone),
        release: local(c.releaseAt, ctx.timezone),
        display: fmtRange(c.callAt, c.releaseAt, ctx.timezone),
        location: c.event.location ?? undefined,
        reasons: c.reasons,
      })),
  };
}

export async function listConflicts(ctx: Ctx, input: { production: string; from?: string; to?: string }) {
  const p = await getProduction(ctx, input.production);
  const from = input.from ? parseTime(input.from, ctx.timezone, "from") : new Date();
  const to = input.to ? parseTime(input.to, ctx.timezone, "to") : undefined;
  const cast = await db
    .selectDistinct({ personId: roleAssignments.personId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roles.productionId, p.id));
  const ids = cast.map((c) => c.personId);
  if (ids.length === 0) return { production: p.title, conflicts: [] };
  const conds = [inArray(conflicts.personId, ids), gte(conflicts.endsAt, from)];
  if (to) conds.push(lte(conflicts.startsAt, to));
  const rows = await db
    .select({ c: conflicts, person: people })
    .from(conflicts)
    .innerJoin(people, eq(people.id, conflicts.personId))
    .where(and(...conds))
    .orderBy(asc(conflicts.startsAt));
  const relevant = rows.filter((r) => !r.c.productionId || r.c.productionId === p.id);

  // Which scheduled calls (drafts included) does each conflict collide with?
  const evConds = [eq(events.productionId, p.id), gte(events.endsAt, from)];
  if (to) evConds.push(lte(events.startsAt, to));
  const evRows = await db.select().from(events).where(and(...evConds));
  const sheets = evRows.length ? await buildCallSheets(await loadCastIndex(p.id), evRows) : [];

  return {
    production: p.title,
    timezone: ctx.timezone,
    conflicts: relevant.map(({ c, person }) => ({
      id: c.id,
      person: personName(person),
      personId: person.id,
      start: local(c.startsAt, ctx.timezone),
      end: local(c.endsAt, ctx.timezone),
      note: c.note ?? undefined,
      collidesWith: sheets
        .filter((s) => s.event.status !== "cancelled")
        .map((s) => ({ s, call: s.calls.get(person.id) }))
        .filter(({ call }) => call && call.callAt < c.endsAt && call.releaseAt > c.startsAt)
        .map(({ s, call }) => ({
          eventId: s.event.id,
          event: s.event.title,
          status: s.event.status,
          called: fmtRange(call!.callAt, call!.releaseAt, ctx.timezone),
          day: local(call!.callAt, ctx.timezone)?.slice(0, 10),
        })),
    })),
  };
}
