import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actorNoteRecipients,
  actorNotes,
  blockCalls,
  eventBlocks,
  events,
  people,
  rehearsalReports,
  roleAssignments,
  roles,
} from "@/db/schema";
import { getCoveredPersonIds } from "./access";

/*
 * Actor notes (director → performers, visible to the performer and their guardians) and
 * stage-manager rehearsal reports (creative team only). Callers authorize; these helpers don't.
 */

export const NOTE_CATEGORIES = ["blocking", "line", "music", "choreo", "character", "general"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<NoteCategory, string> = {
  blocking: "Blocking",
  line: "Lines",
  music: "Music",
  choreo: "Choreo",
  character: "Character",
  general: "General",
};
export const isCategory = (v: unknown): v is NoteCategory => NOTE_CATEGORIES.includes(v as NoteCategory);

export const DEPARTMENTS = [
  { key: "costumes", label: "Costumes" },
  { key: "props", label: "Props" },
  { key: "set", label: "Set" },
  { key: "lighting", label: "Lighting" },
  { key: "sound", label: "Sound" },
  { key: "music", label: "Music" },
  { key: "other", label: "Other / general" },
] as const;
export type DepartmentKey = (typeof DEPARTMENTS)[number]["key"];

/** Unread notes across all productions for the people this user covers (self + wards). For a nav badge. */
export async function getUnreadNoteCount(userId: string, productionId?: string): Promise<number> {
  const covered = await getCoveredPersonIds(userId);
  if (covered.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${actorNoteRecipients.noteId})::int` })
    .from(actorNoteRecipients)
    .innerJoin(actorNotes, eq(actorNotes.id, actorNoteRecipients.noteId))
    .where(
      and(
        inArray(actorNoteRecipients.personId, covered),
        isNull(actorNoteRecipients.readAt),
        productionId ? eq(actorNotes.productionId, productionId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** The report for an event (draft or published), or null. Caller must check the viewer is creative team. */
export async function getReportForEvent(eventId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  return (await db.query.rehearsalReports.findFirst({ where: eq(rehearsalReports.eventId, eventId) })) ?? null;
}

/** People cast in the production (anyone with a role assignment), with their role names. */
export async function getProductionCast(productionId: string) {
  const rows = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, role: roles.name, sort: roles.sortOrder })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(people, eq(people.id, roleAssignments.personId))
    .where(eq(roles.productionId, productionId))
    .orderBy(asc(people.firstName), asc(people.lastName), asc(roles.sortOrder));
  const byId = new Map<string, { id: string; name: string; roles: string[] }>();
  for (const r of rows) {
    const cur = byId.get(r.id) ?? { id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), roles: [] };
    if (!cur.roles.includes(r.role)) cur.roles.push(r.role);
    byId.set(r.id, cur);
  }
  return [...byId.values()];
}

/** Person ids most recently given notes in this production, newest first. */
export async function recentlyNotedPersonIds(productionId: string, limit = 12) {
  const rows = await db
    .select({ personId: actorNoteRecipients.personId, at: sql<string>`max(${actorNotes.createdAt})` })
    .from(actorNoteRecipients)
    .innerJoin(actorNotes, eq(actorNotes.id, actorNoteRecipients.noteId))
    .where(eq(actorNotes.productionId, productionId))
    .groupBy(actorNoteRecipients.personId)
    .orderBy(desc(sql`max(${actorNotes.createdAt})`))
    .limit(limit);
  return rows.map((r) => r.personId);
}

/** Events a note or report can attach to: not cancelled, started already (or today), newest first. */
export async function recentEvents(productionId: string, limit = 20) {
  const horizon = new Date(Date.now() + 18 * 3600_000); // include later today
  return db
    .select({ id: events.id, title: events.title, kind: events.kind, startsAt: events.startsAt, endsAt: events.endsAt, status: events.status })
    .from(events)
    .where(and(eq(events.productionId, productionId), ne(events.status, "cancelled"), lte(events.startsAt, horizon)))
    .orderBy(desc(events.startsAt))
    .limit(limit);
}

/** Scene ids called in an event's blocks, in block order (for pre-filling "scenes covered"). */
export async function scenesForEvent(eventId: string) {
  const rows = await db
    .select({ sceneId: blockCalls.targetId })
    .from(blockCalls)
    .innerJoin(eventBlocks, eq(eventBlocks.id, blockCalls.blockId))
    .where(and(eq(eventBlocks.eventId, eventId), eq(blockCalls.target, "scene")))
    .orderBy(asc(eventBlocks.startsAt), asc(eventBlocks.sortOrder));
  return [...new Set(rows.map((r) => r.sceneId).filter((x): x is string => !!x))];
}
