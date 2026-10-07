import "server-only";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { scheduleChangeNotification, withCallImpact, type TouchedTargets } from "@/lib/changes";
import {
  blockCalls,
  eventBlocks,
  events,
  orgMembers,
  people,
  resources,
  roleAssignments,
  roleGroups,
  roles,
  sceneRoles,
  scenes,
} from "@/db/schema";

/**
 * Shared helpers for the production-management pages (scenes, roles, cast, breakdown, team,
 * settings) and their server actions.
 */

/** Result shape for useActionState-driven forms. */
export type FormState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Invite link to show with a copy button. */
  inviteUrl?: string;
  /** Prewritten message to send with the invite link. */
  shareText?: string;
  /** Changes on every successful submit so client forms can reset. */
  nonce?: number;
};

export class ActionError extends Error {}

/** Convert FormData to a plain object (repeated keys become arrays) and validate with zod. */
export function parseForm<S extends z.ZodType>(schema: S, fd: FormData): z.infer<S> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v !== "string") continue;
    if (k in obj) {
      const cur = obj[k];
      obj[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else obj[k] = v;
  }
  const res = schema.safeParse(obj);
  if (!res.success) {
    const issue = res.error.issues[0];
    const field = issue?.path?.join(".");
    throw new ActionError(issue ? `${field ? `${humanize(field)}: ` : ""}${issue.message}` : "Invalid input");
  }
  return res.data;
}

const FIELD_LABELS: Record<string, string> = { url: "Link" };

function humanize(s: string) {
  if (FIELD_LABELS[s]) return FIELD_LABELS[s];
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Wrap an action body so validation/authorization failures become inline form errors. */
export async function formAction(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    const r = await fn();
    return { ok: true, nonce: Date.now(), ...(r ?? {}) };
  } catch (e) {
    if (e instanceof ActionError) return { error: e.message };
    throw e; // redirect()/notFound() and real bugs propagate
  }
}

/** Accepts "" as undefined, trims. */
export const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Ensure every role id belongs to the production. Returns the deduped ids. */
export async function assertRolesInProduction(productionId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  if (!unique.every(isUuid)) throw new ActionError("Unknown role");
  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.productionId, productionId), inArray(roles.id, unique)));
  if (rows.length !== unique.length) throw new ActionError("Unknown role");
  return unique;
}

export async function assertScenesInProduction(productionId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  if (!unique.every(isUuid)) throw new ActionError("Unknown scene");
  const rows = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(and(eq(scenes.productionId, productionId), inArray(scenes.id, unique)));
  if (rows.length !== unique.length) throw new ActionError("Unknown scene");
  return unique;
}

export async function getRoleInProduction(productionId: string, roleId: string) {
  if (!isUuid(roleId)) throw new ActionError("Unknown role");
  const row = await db.query.roles.findFirst({ where: and(eq(roles.id, roleId), eq(roles.productionId, productionId)) });
  if (!row) throw new ActionError("Unknown role");
  return row;
}

export async function getSceneInProduction(productionId: string, sceneId: string) {
  if (!isUuid(sceneId)) throw new ActionError("Unknown scene");
  const row = await db.query.scenes.findFirst({ where: and(eq(scenes.id, sceneId), eq(scenes.productionId, productionId)) });
  if (!row) throw new ActionError("Unknown scene");
  return row;
}

export async function getGroupInProduction(productionId: string, groupId: string) {
  if (!isUuid(groupId)) throw new ActionError("Unknown group");
  const row = await db.query.roleGroups.findFirst({
    where: and(eq(roleGroups.id, groupId), eq(roleGroups.productionId, productionId)),
  });
  if (!row) throw new ActionError("Unknown group");
  return row;
}

export async function getPersonInOrg(orgId: string, personId: string) {
  if (!isUuid(personId)) throw new ActionError("Unknown person");
  const row = await db.query.people.findFirst({ where: and(eq(people.id, personId), eq(people.orgId, orgId)) });
  if (!row) throw new ActionError("Unknown person");
  return row;
}

/** Make sure a user is at least a member of the org (no-op if already a member/admin). */
export async function ensureOrgMember(orgId: string, userId: string) {
  await db.insert(orgMembers).values({ orgId, userId, role: "member" }).onConflictDoNothing();
}

export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/** Set sortOrder = position (1-based) for the given ids, in one atomic statement. */
export async function renumber(table: typeof scenes | typeof roles, ids: string[]) {
  if (!ids.length) return;
  const cases = sql.join(
    ids.map((id, k) => sql`when ${id}::uuid then ${k + 1}::int`),
    sql` `,
  );
  await db
    .update(table)
    .set({ sortOrder: sql`case ${table.id} ${cases} end` })
    .where(inArray(table.id, ids));
}

/* ───────────────────────── Rehearsal tracking ───────────────────────── */

/** Blocks/events titled like a run-through ("Act 1 run", "Full run", "stumble-through"). */
export const RUN_PATTERN = /\brun\b|run-?through|stumble/i;

export type SceneRehearsalStats = {
  /** Past published rehearsals (distinct events) with a block that calls this scene. */
  count: number;
  last: Date | null;
  /** Next non-cancelled event (drafts included) with a block calling this scene. */
  next: { at: Date; eventId: string; draft: boolean } | null;
};

export type RehearsalStats = {
  scenes: Map<string, SceneRehearsalStats>;
  /** Past published full-cast run-throughs; counted separately, not per scene. */
  runs: { count: number; last: Date | null };
  /** Whether any published rehearsal has happened yet (stats are meaningless before that). */
  started: boolean;
};

/**
 * How often each scene has been worked. Only explicit scene calls count toward a scene; full-cast
 * run-throughs are tallied separately so a weekly run doesn't hide a scene nobody has drilled.
 */
export async function getRehearsalStats(productionId: string, now = new Date()): Promise<RehearsalStats> {
  const sceneRows = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.productionId, productionId));
  const out: RehearsalStats = {
    scenes: new Map(sceneRows.map((s) => [s.id, { count: 0, last: null, next: null }])),
    runs: { count: 0, last: null },
    started: false,
  };
  const rows = await db
    .select({
      eventId: events.id,
      eventTitle: events.title,
      status: events.status,
      eventEnds: events.endsAt,
      blockStarts: eventBlocks.startsAt,
      blockTitle: eventBlocks.title,
      target: blockCalls.target,
      targetId: blockCalls.targetId,
    })
    .from(blockCalls)
    .innerJoin(eventBlocks, eq(eventBlocks.id, blockCalls.blockId))
    .innerJoin(events, eq(events.id, eventBlocks.eventId))
    .where(and(eq(events.productionId, productionId), ne(events.status, "cancelled"), inArray(blockCalls.target, ["scene", "all_cast"])));

  const counted = new Set<string>(); // sceneId:eventId
  const runEvents = new Set<string>();
  for (const r of rows) {
    const past = r.status === "published" && r.eventEnds < now;
    if (past) out.started = true;
    if (r.target === "all_cast") {
      if (past && RUN_PATTERN.test(`${r.blockTitle ?? ""} ${r.eventTitle}`) && !runEvents.has(r.eventId)) {
        runEvents.add(r.eventId);
        out.runs.count++;
        if (!out.runs.last || r.blockStarts > out.runs.last) out.runs.last = r.blockStarts;
      }
      continue;
    }
    const st = out.scenes.get(r.targetId ?? "");
    if (!st) continue;
    if (past) {
      const k = `${r.targetId}:${r.eventId}`;
      if (!counted.has(k)) {
        counted.add(k);
        st.count++;
      }
      if (!st.last || r.blockStarts > st.last) st.last = r.blockStarts;
    } else if (r.blockStarts >= now && (!st.next || r.blockStarts < st.next.at)) {
      st.next = { at: r.blockStarts, eventId: r.eventId, draft: r.status === "draft" };
    }
  }
  if (!out.started) {
    const [anyPast] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.productionId, productionId), eq(events.status, "published"), lt(events.endsAt, now)))
      .limit(1);
    out.started = !!anyPast;
  }
  return out;
}

export const daysSince = (d: Date, now = new Date()) => Math.floor((now.getTime() - d.getTime()) / 86400_000);

/** "fresh" ≤ 7 days, "aging" ≤ 14, "stale" older, "never" not yet. */
export function sceneFreshness(st: SceneRehearsalStats, now = new Date()): "fresh" | "aging" | "stale" | "never" {
  if (!st.last) return "never";
  const d = daysSince(st.last, now);
  return d <= 7 ? "fresh" : d <= 14 ? "aging" : "stale";
}

/* ───────────────────────── Resources ───────────────────────── */

export const RESOURCE_KINDS = ["script", "track", "video", "doc", "link"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Guess a kind from the URL when the editor leaves it on "auto". */
export function guessResourceKind(url: string): ResourceKind {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|\.mp4\b|\.mov\b|loom\.com/.test(u)) return "video";
  if (/\.mp3\b|\.m4a\b|\.wav\b|soundcloud\.com|spotify\.com/.test(u)) return "track";
  if (/\.pdf\b/.test(u)) return "script";
  if (/docs\.google\.com|drive\.google\.com|dropbox\.com|\.docx?\b/.test(u)) return "doc";
  return "link";
}

/**
 * Materials relevant to each covered person: resources on any role they hold, on any scene one of
 * their roles appears in, plus production-wide resources (returned separately as `general`).
 */
export async function getMaterialsForPeople(productionId: string, personIds: string[]) {
  const all = await db
    .select()
    .from(resources)
    .where(eq(resources.productionId, productionId))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));
  const general = all.filter((r) => !r.sceneId && !r.roleId);
  const byPerson = new Map<string, (typeof resources.$inferSelect)[]>();
  if (!personIds.length || all.length === general.length) return { general, byPerson };

  const assigns = await db
    .select({ personId: roleAssignments.personId, roleId: roleAssignments.roleId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roles.productionId, productionId), inArray(roleAssignments.personId, personIds)));
  const roleIds = [...new Set(assigns.map((a) => a.roleId))];
  const sceneLinks = roleIds.length
    ? await db.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds))
    : [];
  for (const pid of personIds) {
    const myRoles = new Set(assigns.filter((a) => a.personId === pid).map((a) => a.roleId));
    if (!myRoles.size) continue;
    const myScenes = new Set(sceneLinks.filter((l) => myRoles.has(l.roleId)).map((l) => l.sceneId));
    const mine = all.filter((r) => (r.roleId && myRoles.has(r.roleId)) || (!r.roleId && r.sceneId && myScenes.has(r.sceneId)));
    if (mine.length) byPerson.set(pid, mine);
  }
  return { general, byPerson };
}

/** Remove schedule calls that point at a deleted scene/role/group (blockCalls has no FK). */
/** Pass a transaction as `q` to make this atomic with the caller's other deletes (default: `db`). */
export async function deleteCallsTargeting(
  target: "scene" | "role" | "group" | "person",
  targetId: string,
  q: Pick<typeof db, "delete"> = db,
) {
  await q.delete(blockCalls).where(and(eq(blockCalls.target, target), eq(blockCalls.targetId, targetId)));
}

/**
 * After removing a role assignment: if the person no longer holds any role in the production, drop
 * the blocks' individual ("person") calls for them there, so the team's call sheets stop listing
 * someone families can no longer see, and the change is recorded as "No longer called".
 * Run inside the same transaction as the unassignment (withCallImpact / mutateCalls).
 */
export async function dropPersonCallsIfUncast(q: Pick<typeof db, "select" | "delete">, productionId: string, personId: string) {
  const still = await q
    .select({ id: roleAssignments.roleId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roles.productionId, productionId), eq(roleAssignments.personId, personId)))
    .limit(1);
  if (still.length) return;
  const blockIds = q
    .select({ id: eventBlocks.id })
    .from(eventBlocks)
    .innerJoin(events, eq(events.id, eventBlocks.eventId))
    .where(eq(events.productionId, productionId));
  await q
    .delete(blockCalls)
    .where(and(eq(blockCalls.target, "person"), eq(blockCalls.targetId, personId), inArray(blockCalls.blockId, blockIds)));
}

/* ───────────────────────── Call-impact wrapper ───────────────────────── */

type ImpactTx = Parameters<Parameters<typeof withCallImpact>[3]>[0];

/**
 * Run a mutation that can change who is called (cast, breakdown, groups, deletes) in a transaction
 * that records per-person changes at upcoming published events, then queue family notifications
 * after commit. Everything inside `fn` must use the `tx` it receives. Returns how many people's
 * calls changed so the UI can say so.
 */
export async function mutateCalls<T>(productionId: string, userId: string, fn: (tx: ImpactTx) => Promise<T>, touched?: TouchedTargets) {
  const { result, changes } = await db.transaction((tx) => withCallImpact(tx, productionId, userId, fn, touched));
  for (const c of changes) scheduleChangeNotification(c);
  const affected = new Set(changes.flatMap((c) => c.affectedPersonIds)).size;
  return { result, changes, affected };
}

/** " Calls updated for 3 people at upcoming rehearsals." or "" */
export const impactNote = (affected: number) =>
  affected ? ` Calls updated for ${affected} ${affected === 1 ? "person" : "people"} at upcoming rehearsals; their families were notified.` : "";
