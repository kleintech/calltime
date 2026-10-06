import "server-only";
import { asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditions,
  creativeTeam,
  events,
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
import { sceneLabel } from "@/lib/calls";
import { deleteCallsTargeting } from "@/lib/production-queries";
import { type Ctx, type Q, fail, isUuid, listForError, norm, personName, getProduction } from "./util";

/* ───────────────────────── Schemas ───────────────────────── */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const productionFields = z.object({
  title: z.string().min(1).describe("Show title, e.g. \"The Pirates of Penzance\""),
  subtitle: z.string().nullish().describe("e.g. \"Fall Musical 2026\""),
  description: z.string().nullish(),
  venue: z.string().nullish().describe("Performance venue"),
  defaultLocation: z.string().nullish().describe("Default rehearsal location; new events use it when none is given"),
  status: z.enum(["planning", "auditions", "rehearsals", "performances", "closed"]).optional(),
  firstRehearsal: dateStr.nullish(),
  openingDate: dateStr.nullish(),
  closingDate: dateStr.nullish(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex color like #7c3aed"),
});
export type ProductionFields = z.infer<typeof productionFields>;

export const roleInput = z.object({
  name: z.string().min(1).describe("Character name exactly as it should appear, e.g. \"Mabel\" or \"Pirates (ensemble)\""),
  newName: z.string().min(1).optional().describe("Rename an existing role (matched by `name`) to this"),
  kind: z.enum(["lead", "supporting", "featured", "ensemble"]).optional().describe("Default: supporting"),
  description: z.string().nullish().describe("Short character description, vocal range, age range…"),
  sortOrder: z.number().int().optional().describe("Display order; defaults to the order given"),
});
export type RoleInput = z.infer<typeof roleInput>;

export const groupInput = z.object({
  name: z.string().min(1).describe("Group name, e.g. \"Pirates\", \"Daughters\", \"Dance Ensemble\""),
  roles: z.array(z.string()).describe("Role names (or ids) in the group. Replaces the group's membership."),
  color: z.string().nullish(),
});
export type GroupInput = z.infer<typeof groupInput>;

export const sceneInput = z.object({
  act: z.number().int().min(0).default(1).describe("Act number (default 1)"),
  number: z.string().min(1).describe("Scene number within the act as text: \"1\", \"3A\", \"Prologue\", \"Finale\""),
  name: z.string().min(1).describe("Scene name / location / main song, e.g. \"A Rocky Seashore\""),
  description: z.string().nullish(),
  songs: z.string().nullish().describe("Songs in the scene, comma separated"),
  pages: z.string().nullish().describe("Script pages, e.g. \"12-18\""),
  sortOrder: z.number().int().optional().describe("Running order; defaults to act/number order as given"),
  roles: z
    .array(z.string())
    .optional()
    .describe("Role names (or ids) that appear in the scene. When given, REPLACES the scene's role list."),
});
export type SceneInput = z.infer<typeof sceneInput>;

/* ───────────────────────── Productions ───────────────────────── */

function prodValues(f: Partial<ProductionFields>) {
  const v: Partial<typeof productions.$inferInsert> = {};
  if (f.title !== undefined) v.title = f.title.trim();
  if (f.subtitle !== undefined) v.subtitle = f.subtitle ?? null;
  if (f.description !== undefined) v.description = f.description ?? null;
  if (f.venue !== undefined) v.venue = f.venue ?? null;
  if (f.defaultLocation !== undefined) v.defaultLocation = f.defaultLocation ?? null;
  if (f.status !== undefined) v.status = f.status;
  if (f.firstRehearsal !== undefined) v.firstRehearsal = f.firstRehearsal ?? null;
  if (f.openingDate !== undefined) v.openingDate = f.openingDate ?? null;
  if (f.closingDate !== undefined) v.closingDate = f.closingDate ?? null;
  if (f.accentColor !== undefined) v.accentColor = f.accentColor;
  return v;
}

export async function listProductions(ctx: Ctx) {
  const rows = await db
    .select()
    .from(productions)
    .where(eq(productions.orgId, ctx.orgId))
    .orderBy(asc(productions.title));
  const ids = rows.map((r) => r.id);
  const [roleCounts, sceneCounts, eventCounts] = ids.length
    ? await Promise.all([
        db.select({ id: roles.productionId, n: count() }).from(roles).where(inArray(roles.productionId, ids)).groupBy(roles.productionId),
        db.select({ id: scenes.productionId, n: count() }).from(scenes).where(inArray(scenes.productionId, ids)).groupBy(scenes.productionId),
        db.select({ id: events.productionId, n: count() }).from(events).where(inArray(events.productionId, ids)).groupBy(events.productionId),
      ])
    : [[], [], []];
  const m = (xs: { id: string; n: number }[]) => new Map(xs.map((x) => [x.id, x.n]));
  const rc = m(roleCounts), sc = m(sceneCounts), ec = m(eventCounts);
  return {
    organization: ctx.orgName,
    timezone: ctx.timezone,
    productions: rows.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      status: p.status,
      firstRehearsal: p.firstRehearsal,
      openingDate: p.openingDate,
      closingDate: p.closingDate,
      counts: { roles: rc.get(p.id) ?? 0, scenes: sc.get(p.id) ?? 0, events: ec.get(p.id) ?? 0 },
    })),
  };
}

export async function createProduction(ctx: Ctx, f: ProductionFields, q: Q = db) {
  const [p] = await q
    .insert(productions)
    .values({ ...prodValues(f), title: f.title.trim(), orgId: ctx.orgId })
    .returning();
  return p;
}

export async function updateProduction(ctx: Ctx, ref: string, f: Partial<ProductionFields>, q: Q = db) {
  const p = await getProduction(ctx, ref, q);
  const v = prodValues(f);
  if (Object.keys(v).length === 0) return p;
  const [u] = await q.update(productions).set(v).where(eq(productions.id, p.id)).returning();
  return u;
}

/** Everything about a production in one compact object. */
export async function getProductionDetail(ctx: Ctx, ref: string) {
  const p = await getProduction(ctx, ref);
  const [roleRows, groupRows, sceneRows, teamRows, eventCounts, auditionCount] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, p.id)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select().from(roleGroups).where(eq(roleGroups.productionId, p.id)).orderBy(asc(roleGroups.name)),
    db.select().from(scenes).where(eq(scenes.productionId, p.id)).orderBy(asc(scenes.sortOrder), asc(scenes.act)),
    db
      .select({ title: creativeTeam.title, canEdit: creativeTeam.canEdit, name: users.name, email: users.email })
      .from(creativeTeam)
      .innerJoin(users, eq(users.id, creativeTeam.userId))
      .where(eq(creativeTeam.productionId, p.id)),
    db.select({ status: events.status, n: count() }).from(events).where(eq(events.productionId, p.id)).groupBy(events.status),
    db.select({ n: count() }).from(auditions).where(eq(auditions.productionId, p.id)),
  ]);
  const roleIds = roleRows.map((r) => r.id);
  const [assignRows, sceneRoleRows, memberRows] = roleIds.length
    ? await Promise.all([
        db
          .select({ roleId: roleAssignments.roleId, kind: roleAssignments.kind, person: people })
          .from(roleAssignments)
          .innerJoin(people, eq(people.id, roleAssignments.personId))
          .where(inArray(roleAssignments.roleId, roleIds)),
        db.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds)),
        db.select().from(roleGroupMembers).where(inArray(roleGroupMembers.roleId, roleIds)),
      ])
    : [[], [], []];
  const roleName = new Map(roleRows.map((r) => [r.id, r.name]));
  const castIds = new Set(assignRows.map((a) => a.person.id));

  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    status: p.status,
    description: p.description,
    venue: p.venue,
    defaultLocation: p.defaultLocation,
    firstRehearsal: p.firstRehearsal,
    openingDate: p.openingDate,
    closingDate: p.closingDate,
    timezone: ctx.timezone,
    team: teamRows,
    counts: {
      roles: roleRows.length,
      scenes: sceneRows.length,
      groups: groupRows.length,
      castMembers: castIds.size,
      events: Object.fromEntries(eventCounts.map((e) => [e.status, e.n])),
      auditions: auditionCount[0]?.n ?? 0,
    },
    roles: roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      description: r.description || undefined,
      cast: assignRows
        .filter((a) => a.roleId === r.id)
        .map((a) => ({ personId: a.person.id, name: personName(a.person), kind: a.kind })),
    })),
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      roles: memberRows.filter((m) => m.groupId === g.id).map((m) => roleName.get(m.roleId)),
    })),
    scenes: sceneRows.map((s) => ({
      id: s.id,
      act: s.act,
      number: s.number,
      name: s.name,
      label: sceneLabel(s),
      songs: s.songs || undefined,
      pages: s.pages || undefined,
      roles: sceneRoleRows.filter((sr) => sr.sceneId === s.id).map((sr) => roleName.get(sr.roleId)),
    })),
  };
}

/* ───────────────────────── Roles ───────────────────────── */

type RoleRow = typeof roles.$inferSelect;

export async function loadRoles(productionId: string, q: Q = db) {
  return q.select().from(roles).where(eq(roles.productionId, productionId));
}

/** Resolve role refs (names or ids) → rows. Unknown names are returned in `missing`. */
export function matchRoles(all: RoleRow[], refs: string[]) {
  const found: RoleRow[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const r = isUuid(ref) ? all.find((x) => x.id === ref.trim()) : all.find((x) => norm(x.name) === norm(ref));
    if (r) {
      if (!found.includes(r)) found.push(r);
    } else missing.push(ref);
  }
  return { found, missing };
}

export function requireRoles(all: RoleRow[], refs: string[], context: string) {
  const { found, missing } = matchRoles(all, refs);
  if (missing.length)
    fail(
      `${context}: unknown role(s) ${missing.map((m) => `"${m}"`).join(", ")}. Create them with upsert_roles first. ` +
        `Existing roles: ${listForError(all.map((r) => r.name)) || "(none)"}`,
    );
  return found;
}

/** Bulk upsert roles by name. Returns all roles of the production afterwards. */
export async function upsertRoles(productionId: string, inputs: RoleInput[], q: Q = db) {
  const existing = await loadRoles(productionId, q);
  let nextSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const input of inputs) {
    const name = input.name.trim();
    // A role already renamed by an earlier run is found by its new name (keeps re-runs idempotent).
    const hit =
      existing.find((r) => norm(r.name) === norm(name)) ??
      (input.newName ? existing.find((r) => norm(r.name) === norm(input.newName)) : undefined);
    if (!hit) {
      const [row] = await q
        .insert(roles)
        .values({
          productionId,
          name: (input.newName ?? name).trim(),
          kind: input.kind ?? "supporting",
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? nextSort++,
        })
        .returning();
      existing.push(row);
      created.push(row.name);
      continue;
    }
    const set: Partial<RoleRow> = {};
    if (input.newName && input.newName.trim() !== hit.name) set.name = input.newName.trim();
    if (input.kind && input.kind !== hit.kind) set.kind = input.kind;
    if (input.description !== undefined && (input.description ?? null) !== hit.description) set.description = input.description ?? null;
    if (input.sortOrder !== undefined && input.sortOrder !== hit.sortOrder) set.sortOrder = input.sortOrder;
    if (Object.keys(set).length) {
      const [row] = await q.update(roles).set(set).where(eq(roles.id, hit.id)).returning();
      Object.assign(hit, row);
      updated.push(row.name);
    } else unchanged.push(hit.name);
  }
  return { roles: existing, created, updated, unchanged };
}

export async function deleteRole(productionId: string, roleRef: string, q: Q) {
  const [role] = requireRoles(await loadRoles(productionId, q), [roleRef], "delete_role");
  const assigned = await q.select({ n: count() }).from(roleAssignments).where(eq(roleAssignments.roleId, role.id));
  // Same as the web delete: drop block calls that targeted this role (no FK cascade from a
  // polymorphic targetId), then the role. Callers run this in a transaction.
  await deleteCallsTargeting("role", role.id, q);
  await q.delete(roles).where(eq(roles.id, role.id));
  return { deleted: role.name, unassignedPeople: assigned[0]?.n ?? 0 };
}

/* ───────────────────────── Groups ───────────────────────── */

export async function upsertGroups(productionId: string, inputs: GroupInput[], q: Q = db, allRoles?: RoleRow[]) {
  const roleRows = allRoles ?? (await loadRoles(productionId, q));
  const existing = await q.select().from(roleGroups).where(eq(roleGroups.productionId, productionId));
  const out: { name: string; id: string; roles: string[]; created: boolean }[] = [];
  // Validate every group before writing any.
  for (const g of inputs) requireRoles(roleRows, g.roles, `Group "${g.name}"`);
  for (const g of inputs) {
    const members = requireRoles(roleRows, g.roles, `Group "${g.name}"`);
    let row = existing.find((x) => norm(x.name) === norm(g.name));
    const created = !row;
    if (!row) {
      [row] = await q.insert(roleGroups).values({ productionId, name: g.name.trim(), color: g.color ?? null }).returning();
      existing.push(row);
    } else if (g.color !== undefined && (g.color ?? null) !== row.color) {
      await q.update(roleGroups).set({ color: g.color ?? null }).where(eq(roleGroups.id, row.id));
    }
    await q.delete(roleGroupMembers).where(eq(roleGroupMembers.groupId, row.id));
    if (members.length) await q.insert(roleGroupMembers).values(members.map((r) => ({ groupId: row!.id, roleId: r.id })));
    out.push({ name: row.name, id: row.id, roles: members.map((r) => r.name), created });
  }
  return out;
}

/* ───────────────────────── Scenes ───────────────────────── */

type SceneRow = typeof scenes.$inferSelect;

export async function loadScenes(productionId: string, q: Q = db) {
  return q.select().from(scenes).where(eq(scenes.productionId, productionId)).orderBy(asc(scenes.sortOrder));
}

/**
 * Resolve a scene ref: id, exact name, "Act 1 Sc 3" / "Act 1 Scene 3" / "1-3" / "1.3" / "1:3",
 * or a bare number when only one act has it.
 */
export function matchScene(all: SceneRow[], ref: string): SceneRow | null {
  const r = ref.trim();
  if (isUuid(r)) return all.find((s) => s.id === r) ?? null;
  const byLabel = all.find((s) => norm(sceneLabel(s)) === norm(r));
  if (byLabel) return byLabel;
  const byName = all.filter((s) => norm(s.name) === norm(r));
  if (byName.length === 1) return byName[0];
  // "Act 1 Sc 3", "Act 1, Scene 3A", "Act 2 - 1", optionally followed by ": name". A separator or
  // "Sc" is required so "Act 12" isn't read as act 1 scene 2; ranges like "Sc 1-2" don't match.
  const m =
    r.match(/^act\s*(\d+)(?:\s*[,\-–]\s*|\s*sc(?:ene)?\.?\s*|\s+)(\w+)(?:\s*:.*)?$/i) ??
    r.match(/^(\d+)\s*[.:\-]\s*(\w+)$/);
  if (m) {
    const hit = all.find((s) => s.act === Number(m[1]) && norm(s.number) === norm(m[2]));
    if (hit) return hit;
  }
  const byNumber = all.filter((s) => norm(s.number) === norm(r.replace(/^sc(?:ene)?\.?\s*/i, "")));
  if (byNumber.length === 1) return byNumber[0];
  return null;
}

export function requireScene(all: SceneRow[], ref: string) {
  const s = matchScene(all, ref);
  if (!s)
    fail(
      `Unknown scene "${ref}". Use a scene id, its name, or "Act N Sc M". Scenes: ${listForError(all.map((x) => sceneLabel(x))) || "(none)"}`,
    );
  return s!;
}

async function setSceneRoleIds(sceneId: string, roleIds: string[], q: Q) {
  await q.delete(sceneRoles).where(eq(sceneRoles.sceneId, sceneId));
  const uniq = [...new Set(roleIds)];
  if (uniq.length) await q.insert(sceneRoles).values(uniq.map((roleId) => ({ sceneId, roleId })));
}

/** Bulk upsert scenes, matched by (act, number) only. */
export async function upsertScenes(productionId: string, inputs: SceneInput[], q: Q = db, allRoles?: RoleRow[]) {
  const roleRows = allRoles ?? (await loadRoles(productionId, q));
  const existing = await loadScenes(productionId, q);
  // Validate every role reference up front so a typo doesn't leave a half-applied batch.
  for (const s of inputs) if (s.roles) requireRoles(roleRows, s.roles, `Scene ${s.act}-${s.number} "${s.name}"`);

  let nextSort = existing.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  const out: { id: string; label: string; roles?: string[]; created: boolean }[] = [];
  for (const s of inputs) {
    const act = s.act ?? 1;
    // Identity is (act, number). Names repeat ("A Rocky Seashore" in 1-1 and 1-3), so never
    // match by name — that would merge or renumber scenes.
    let row = existing.find((x) => x.act === act && norm(x.number) === norm(s.number));
    const created = !row;
    if (!row) {
      [row] = await q
        .insert(scenes)
        .values({
          productionId,
          act,
          number: s.number.trim(),
          name: s.name.trim(),
          description: s.description ?? null,
          songs: s.songs ?? null,
          pages: s.pages ?? null,
          sortOrder: s.sortOrder ?? nextSort++,
        })
        .returning();
      existing.push(row);
    } else {
      const set: Partial<SceneRow> = {};
      if (row.number !== s.number.trim()) set.number = s.number.trim();
      if (row.name !== s.name.trim()) set.name = s.name.trim();
      if (s.description !== undefined && (s.description ?? null) !== row.description) set.description = s.description ?? null;
      if (s.songs !== undefined && (s.songs ?? null) !== row.songs) set.songs = s.songs ?? null;
      if (s.pages !== undefined && (s.pages ?? null) !== row.pages) set.pages = s.pages ?? null;
      if (s.sortOrder !== undefined && s.sortOrder !== row.sortOrder) set.sortOrder = s.sortOrder;
      if (Object.keys(set).length) {
        const [u] = await q.update(scenes).set(set).where(eq(scenes.id, row.id)).returning();
        Object.assign(row, u);
      }
    }
    let roleNames: string[] | undefined;
    if (s.roles) {
      const rs = requireRoles(roleRows, s.roles, `Scene "${s.name}"`);
      await setSceneRoleIds(row.id, rs.map((r) => r.id), q);
      roleNames = rs.map((r) => r.name);
    }
    out.push({ id: row.id, label: sceneLabel(row), roles: roleNames, created });
  }
  return out;
}

export async function setSceneRoles(
  ctx: Ctx,
  productionRef: string,
  sceneRef: string,
  roleRefs: string[],
  mode: "replace" | "add" | "remove",
  q: Q = db,
) {
  const p = await getProduction(ctx, productionRef, q);
  const scene = requireScene(await loadScenes(p.id, q), sceneRef);
  const roleRows = await loadRoles(p.id, q);
  const rs = requireRoles(roleRows, roleRefs, "set_scene_roles");
  const current = (await q.select().from(sceneRoles).where(eq(sceneRoles.sceneId, scene.id))).map((x) => x.roleId);
  let next: string[];
  if (mode === "replace") next = rs.map((r) => r.id);
  else if (mode === "add") next = [...current, ...rs.map((r) => r.id)];
  else next = current.filter((id) => !rs.some((r) => r.id === id));
  await setSceneRoleIds(scene.id, next, q);
  const names = new Map(roleRows.map((r) => [r.id, r.name]));
  return { scene: sceneLabel(scene), roles: [...new Set(next)].map((id) => names.get(id)) };
}

export async function loadGroups(productionId: string, q: Q = db) {
  return q.select().from(roleGroups).where(eq(roleGroups.productionId, productionId));
}
