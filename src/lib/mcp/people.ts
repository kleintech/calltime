import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { guardianships, people, roleAssignments, roles } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth";
import { loadRoles, requireRoles } from "./production";
import { type Ctx, type Q, fail, getProduction, loadOrgPeople, matchPerson, norm, personName, resolvePerson, splitName } from "./util";

export const guardianInput = z.object({
  name: z.string().min(1).describe("Guardian's full name"),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  relationship: z.string().nullish().describe("e.g. Mother, Father, Grandparent. Default: Parent"),
});

export const personInput = z.object({
  name: z.string().optional().describe("Full name (\"Maya Rivera\"). Alternatively give firstName/lastName."),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().nullish().describe("Matching key: an existing person with this email is updated instead of duplicated"),
  phone: z.string().nullish(),
  isMinor: z.boolean().optional().describe("Under 18. Minors are usually reached through their guardians."),
  birthYear: z.number().int().nullish(),
  notes: z.string().nullish(),
  guardians: z.array(guardianInput).optional().describe("Parents/guardians (each also stored as a person and linked)"),
});
export type PersonInput = z.infer<typeof personInput>;

type PersonRow = typeof people.$inferSelect;

function nameOf(input: { name?: string; firstName?: string; lastName?: string }) {
  if (input.firstName) return { firstName: input.firstName.trim(), lastName: (input.lastName ?? "").trim() };
  if (input.name) return splitName(input.name);
  return fail("Each person needs `name` or `firstName`.");
}

/**
 * Find-or-create one person: match by email (case-insensitive) first, else exact full name.
 * Only provided fields are updated on a match.
 */
async function upsertOne(
  ctx: Ctx,
  all: PersonRow[],
  input: Omit<PersonInput, "guardians">,
  q: Q,
): Promise<{ row: PersonRow; created: boolean }> {
  const { firstName, lastName } = nameOf(input);
  const email = input.email ? normalizeEmail(input.email) : null;
  const full = `${firstName} ${lastName}`.trim();
  let hit = email ? all.find((p) => norm(p.email) === email) : undefined;
  if (!hit) {
    // Don't merge two different people who share a name but have different emails, and never
    // attach to someone with a login account on name alone — a guardianship links the account to
    // a child's calls, so a namesake would gain access. (Include emails to match account holders.)
    const byName = all.filter(
      (p) => norm(personName(p)) === norm(full) && (email ? !p.email || norm(p.email) === email : !p.userId),
    );
    if (byName.length > 1)
      fail(`"${full}" matches ${byName.length} people in this organization; include their email to say which one.`);
    hit = byName[0];
  }
  if (!hit) {
    const [row] = await q
      .insert(people)
      .values({
        orgId: ctx.orgId,
        firstName,
        lastName,
        email,
        phone: input.phone ?? null,
        isMinor: input.isMinor ?? false,
        birthYear: input.birthYear ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    all.push(row);
    return { row, created: true };
  }
  const set: Partial<PersonRow> = {};
  if (firstName !== hit.firstName) set.firstName = firstName;
  if ((input.lastName !== undefined || input.name !== undefined) && lastName !== hit.lastName) set.lastName = lastName;
  if (email && email !== hit.email) set.email = email;
  if (input.phone !== undefined && (input.phone ?? null) !== hit.phone) set.phone = input.phone ?? null;
  if (input.isMinor !== undefined && input.isMinor !== hit.isMinor) set.isMinor = input.isMinor;
  if (input.birthYear !== undefined && (input.birthYear ?? null) !== hit.birthYear) set.birthYear = input.birthYear ?? null;
  if (input.notes !== undefined && (input.notes ?? null) !== hit.notes) set.notes = input.notes ?? null;
  if (Object.keys(set).length) {
    const [row] = await q.update(people).set(set).where(eq(people.id, hit.id)).returning();
    Object.assign(hit, row);
  }
  return { row: hit, created: false };
}

export async function upsertPeople(ctx: Ctx, inputs: PersonInput[], q: Q = db, all?: PersonRow[]) {
  const pool = all ?? (await loadOrgPeople(ctx, q));
  const results: {
    id: string;
    name: string;
    created: boolean;
    guardians?: { id: string; name: string; created: boolean }[];
  }[] = [];
  for (const input of inputs) {
    const { row, created } = await upsertOne(ctx, pool, input, q);
    const res: (typeof results)[number] = { id: row.id, name: personName(row), created };
    if (input.guardians?.length) {
      res.guardians = [];
      for (const g of input.guardians) {
        const { row: gRow, created: gCreated } = await upsertOne(ctx, pool, { name: g.name, email: g.email, phone: g.phone }, q);
        if (gRow.id === row.id) fail(`${personName(row)} can't be their own guardian.`);
        await q
          .insert(guardianships)
          .values({ guardianId: gRow.id, minorId: row.id, relationship: g.relationship?.trim() || "Parent" })
          .onConflictDoUpdate({
            target: [guardianships.guardianId, guardianships.minorId],
            set: { relationship: g.relationship?.trim() || "Parent" },
          });
        res.guardians.push({ id: gRow.id, name: personName(gRow), created: gCreated });
      }
    }
    results.push(res);
  }
  return results;
}

export async function listPeople(ctx: Ctx, opts: { query?: string; production?: string; limit?: number }) {
  let pool = await loadOrgPeople(ctx);
  let productionRoles: Map<string, { role: string; kind: string }[]> | null = null;
  if (opts.production) {
    const p = await getProduction(ctx, opts.production);
    const rows = await db
      .select({ personId: roleAssignments.personId, role: roles.name, kind: roleAssignments.kind })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roles.productionId, p.id));
    productionRoles = new Map();
    for (const r of rows) {
      const arr = productionRoles.get(r.personId) ?? [];
      arr.push({ role: r.role, kind: r.kind });
      productionRoles.set(r.personId, arr);
    }
    pool = pool.filter((x) => productionRoles!.has(x.id));
  }
  if (opts.query) {
    const qn = norm(opts.query);
    pool = pool.filter((x) => norm(personName(x)).includes(qn) || norm(x.email).includes(qn));
  }
  pool.sort((a, b) => personName(a).localeCompare(personName(b)));
  const total = pool.length;
  pool = pool.slice(0, opts.limit ?? 200);
  const ids = pool.map((x) => x.id);
  const links = ids.length
    ? await db
        .select()
        .from(guardianships)
        .where(inArray(guardianships.minorId, ids))
    : [];
  const all = await loadOrgPeople(ctx);
  const byId = new Map(all.map((x) => [x.id, x]));
  return {
    total,
    people: pool.map((x) => ({
      id: x.id,
      name: personName(x),
      email: x.email ?? undefined,
      phone: x.phone ?? undefined,
      isMinor: x.isMinor || undefined,
      hasAccount: !!x.userId || undefined,
      guardians: links
        .filter((l) => l.minorId === x.id)
        .map((l) => ({ id: l.guardianId, name: byId.get(l.guardianId) ? personName(byId.get(l.guardianId)!) : "?", relationship: l.relationship })),
      roles: productionRoles?.get(x.id),
    })),
  };
}

export const assignmentInput = z.object({
  person: z.string().describe("Person id, email, or exact full name"),
  role: z.string().describe("Role name or id"),
  kind: z
    .enum(["primary", "understudy", "swing"])
    .default("primary")
    .describe("primary = plays it; understudy = covers it (not called for scene/group calls); swing = covers several ensemble tracks"),
});
export type AssignmentInput = z.infer<typeof assignmentInput>;

export async function assignRoles(
  ctx: Ctx,
  productionId: string,
  assignments: AssignmentInput[],
  q: Q = db,
  pool?: PersonRow[],
  roleRows?: (typeof roles.$inferSelect)[],
) {
  const allPeople = pool ?? (await loadOrgPeople(ctx, q));
  const allRoles = roleRows ?? (await loadRoles(productionId, q));
  // Resolve everything before writing anything.
  const resolved = assignments.map((a) => ({
    person: resolvePerson(allPeople, a.person),
    role: requireRoles(allRoles, [a.role], "assign_roles")[0],
    kind: a.kind ?? "primary",
  }));
  for (const r of resolved) {
    await q
      .insert(roleAssignments)
      .values({ roleId: r.role.id, personId: r.person.id, kind: r.kind })
      .onConflictDoUpdate({ target: [roleAssignments.roleId, roleAssignments.personId], set: { kind: r.kind } });
  }
  return resolved.map((r) => ({ person: personName(r.person), role: r.role.name, kind: r.kind }));
}

export async function unassignRole(ctx: Ctx, productionRef: string, personRef: string, roleRef: string) {
  const p = await getProduction(ctx, productionRef);
  const person = matchPerson(await loadOrgPeople(ctx), personRef) ?? fail(`No person "${personRef}".`);
  const [role] = requireRoles(await loadRoles(p.id), [roleRef], "unassign_role");
  const del = await db
    .delete(roleAssignments)
    .where(and(eq(roleAssignments.roleId, role.id), eq(roleAssignments.personId, person.id)))
    .returning();
  return { removed: del.length > 0, person: personName(person), role: role.name };
}
