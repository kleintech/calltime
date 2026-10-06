import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  blockCalls,
  eventBlocks,
  events,
  people,
  productions,
  roleAssignments,
  roleGroupMembers,
  roleGroups,
  roles,
  sceneRoles,
  scenes,
} from "@/db/schema";

/**
 * The call engine: turns "this block rehearses Scene 3 + the Pirates" into
 * "Maya is called 6:00–7:30pm".
 *
 * Resolution rules for a block call target:
 *   scene    → every role in the scene → people with a primary or swing assignment
 *   role     → every person assigned to the role (understudies included — calling a role by name
 *              means "everyone who plays it")
 *   group    → every role in the group → primary/swing assignees
 *   person   → that person
 *   all_cast → every person with any assignment in the production
 * A person's call for an event = earliest start / latest end across the blocks they're called to.
 */

export type ProductionCastIndex = {
  productionId: string;
  roleById: Map<string, typeof roles.$inferSelect>;
  sceneById: Map<string, typeof scenes.$inferSelect>;
  groupById: Map<string, typeof roleGroups.$inferSelect>;
  /** roleId → [{personId, kind}] */
  assigneesByRole: Map<string, { personId: string; kind: "primary" | "understudy" | "swing" }[]>;
  rolesByScene: Map<string, string[]>;
  rolesByGroup: Map<string, string[]>;
  /** personId → roleIds */
  rolesByPerson: Map<string, string[]>;
  allCast: Set<string>;
};

export async function loadCastIndex(productionId: string): Promise<ProductionCastIndex> {
  const [roleRows, sceneRows, groupRows] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)),
    db.select().from(scenes).where(eq(scenes.productionId, productionId)),
    db.select().from(roleGroups).where(eq(roleGroups.productionId, productionId)),
  ]);
  const roleIds = roleRows.map((r) => r.id);
  const [assignRows, sceneRoleRows, groupMemberRows] = roleIds.length
    ? await Promise.all([
        db.select().from(roleAssignments).where(inArray(roleAssignments.roleId, roleIds)),
        db.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds)),
        db.select().from(roleGroupMembers).where(inArray(roleGroupMembers.roleId, roleIds)),
      ])
    : [[], [], []];

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
  for (const gm of groupMemberRows) push(idx.rolesByGroup, gm.groupId, gm.roleId);
  return idx;
}

export type CallTarget = { target: "scene" | "role" | "group" | "person" | "all_cast"; targetId: string | null };

/** People called by a single target. */
export function resolveTarget(idx: ProductionCastIndex, t: CallTarget): Set<string> {
  const out = new Set<string>();
  const addRole = (roleId: string, includeUnderstudies: boolean) => {
    for (const a of idx.assigneesByRole.get(roleId) ?? []) {
      if (includeUnderstudies || a.kind !== "understudy") out.add(a.personId);
    }
  };
  switch (t.target) {
    case "all_cast":
      for (const p of idx.allCast) out.add(p);
      break;
    case "person":
      if (t.targetId) out.add(t.targetId);
      break;
    case "role":
      if (t.targetId) addRole(t.targetId, true);
      break;
    case "scene":
      for (const r of idx.rolesByScene.get(t.targetId ?? "") ?? []) addRole(r, false);
      break;
    case "group":
      for (const r of idx.rolesByGroup.get(t.targetId ?? "") ?? []) addRole(r, false);
      break;
  }
  return out;
}

/** Human label for a target ("Act 1 Sc 3: Pirate Cave", "Pirates", "All cast"). */
export function targetLabel(idx: ProductionCastIndex, t: CallTarget, personName?: (id: string) => string) {
  switch (t.target) {
    case "all_cast":
      return "Full cast";
    case "scene": {
      const s = idx.sceneById.get(t.targetId ?? "");
      return s ? sceneLabel(s) : "Scene";
    }
    case "role":
      return idx.roleById.get(t.targetId ?? "")?.name ?? "Role";
    case "group":
      return idx.groupById.get(t.targetId ?? "")?.name ?? "Group";
    case "person":
      return personName?.(t.targetId ?? "") ?? "Called individually";
  }
}

export function sceneLabel(s: { act: number; number: string; name: string }) {
  const num = /^\d+[A-Za-z]?$/.test(s.number) ? `Sc ${s.number}` : s.number;
  return `Act ${s.act} ${num}: ${s.name}`;
}

export type BlockWithCalls = typeof eventBlocks.$inferSelect & {
  calls: CallTarget[];
  labels: string[];
  personIds: Set<string>;
};

export type EventCallSheet = {
  event: typeof events.$inferSelect;
  blocks: BlockWithCalls[];
  /** personId → their call for this event */
  calls: Map<string, PersonEventCall>;
};

export type PersonEventCall = {
  personId: string;
  callAt: Date;
  releaseAt: Date;
  blockIds: string[];
  /** What they're called for, deduped, in block order ("Act 1 Sc 2: …", "Pirates"). */
  reasons: string[];
};

/** Build call sheets for a set of events that all belong to one production. */
export async function buildCallSheets(
  idx: ProductionCastIndex,
  eventRows: (typeof events.$inferSelect)[],
): Promise<EventCallSheet[]> {
  if (eventRows.length === 0) return [];
  const blockRows = await db
    .select()
    .from(eventBlocks)
    .where(inArray(eventBlocks.eventId, eventRows.map((e) => e.id)))
    .orderBy(asc(eventBlocks.startsAt), asc(eventBlocks.sortOrder));
  const callRows = blockRows.length
    ? await db.select().from(blockCalls).where(inArray(blockCalls.blockId, blockRows.map((b) => b.id)))
    : [];

  const callsByBlock = new Map<string, CallTarget[]>();
  for (const c of callRows) {
    const arr = callsByBlock.get(c.blockId) ?? [];
    arr.push({ target: c.target, targetId: c.targetId });
    callsByBlock.set(c.blockId, arr);
  }

  return eventRows.map((event) => {
    const blocks: BlockWithCalls[] = blockRows
      .filter((b) => b.eventId === event.id)
      .map((b) => {
        const calls = callsByBlock.get(b.id) ?? [];
        const personIds = new Set<string>();
        for (const c of calls) for (const p of resolveTarget(idx, c)) personIds.add(p);
        return { ...b, calls, labels: calls.map((c) => targetLabel(idx, c)), personIds };
      });

    const calls = new Map<string, PersonEventCall>();
    for (const b of blocks) {
      for (const pid of b.personIds) {
        const reasons = b.calls
          .filter((c) => resolveTarget(idx, c).has(pid))
          .map((c) => (b.title && c.target !== "scene" ? b.title : targetLabel(idx, c)));
        const cur = calls.get(pid);
        if (!cur) {
          calls.set(pid, { personId: pid, callAt: b.startsAt, releaseAt: b.endsAt, blockIds: [b.id], reasons: dedupe(reasons) });
        } else {
          if (b.startsAt < cur.callAt) cur.callAt = b.startsAt;
          if (b.endsAt > cur.releaseAt) cur.releaseAt = b.endsAt;
          cur.blockIds.push(b.id);
          cur.reasons = dedupe([...cur.reasons, ...reasons]);
        }
      }
    }
    return { event, blocks, calls };
  });
}

function dedupe(xs: string[]) {
  return [...new Set(xs)];
}

export type PersonCall = PersonEventCall & {
  event: typeof events.$inferSelect;
  production: typeof productions.$inferSelect;
  person: typeof people.$inferSelect;
  blocks: BlockWithCalls[]; // only the blocks this person is in
};

/**
 * Every call for the given people across all their productions, in time order.
 * Only published + cancelled events (cancellations are shown so families see them),
 * unless includeDrafts.
 */
export async function getCallsForPeople(
  personIds: string[],
  opts: { from?: Date; to?: Date; includeDrafts?: boolean } = {},
): Promise<PersonCall[]> {
  if (personIds.length === 0) return [];
  const personRows = await db.select().from(people).where(inArray(people.id, personIds));
  const personById = new Map(personRows.map((p) => [p.id, p]));

  const prodRows = await db
    .selectDistinct({ productionId: roles.productionId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(inArray(roleAssignments.personId, personIds));

  const out: PersonCall[] = [];
  for (const { productionId } of prodRows) {
    const production = await db.query.productions.findFirst({ where: eq(productions.id, productionId) });
    if (!production) continue;
    const conds = [eq(events.productionId, productionId)];
    // Families only see events that were actually published at some point: a never-published
    // draft that got cancelled must not leak into My Calls or the calendar feed.
    if (!opts.includeDrafts) conds.push(ne(events.status, "draft"), isNotNull(events.publishedAt));
    if (opts.from) conds.push(gte(events.endsAt, opts.from));
    if (opts.to) conds.push(lte(events.startsAt, opts.to));
    const eventRows = await db.select().from(events).where(and(...conds)).orderBy(asc(events.startsAt));
    const idx = await loadCastIndex(productionId);
    const sheets = await buildCallSheets(idx, eventRows);
    for (const sheet of sheets) {
      for (const pid of personIds) {
        const call = sheet.calls.get(pid);
        const person = personById.get(pid);
        if (!call || !person) continue;
        out.push({
          ...call,
          event: sheet.event,
          production,
          person,
          blocks: sheet.blocks.filter((b) => b.personIds.has(pid)),
        });
      }
    }
  }
  return out.sort((a, b) => a.callAt.getTime() - b.callAt.getTime() || a.person.firstName.localeCompare(b.person.firstName));
}

/** Full call sheet for one event (creative-team view). */
export async function getEventCallSheet(eventId: string) {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) return null;
  const idx = await loadCastIndex(event.productionId);
  const [sheet] = await buildCallSheets(idx, [event]);
  const personIds = [...sheet.calls.keys()];
  const personRows = personIds.length ? await db.select().from(people).where(inArray(people.id, personIds)) : [];
  return { ...sheet, idx, people: new Map(personRows.map((p) => [p.id, p])) };
}
