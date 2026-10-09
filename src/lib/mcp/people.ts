import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { guardianships, people, roleAssignments, roles } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth";
import { dropPersonCallsIfUncast } from "@/lib/production-queries";
import { loadRoles, requireRoles } from "./production";
import { type Ctx, type Q, fail, getProduction, loadOrgPeople, matchPerson, norm, personName, resolvePerson, splitName } from "./util";

export const guardianInput = z.object({
  name: z.string().max(4000).min(1).describe("Guardian's full name"),
  email: z.string().max(4000).email().nullish(),
  phone: z.string().max(4000).nullish(),
  relationship: z.string().max(4000).nullish().describe("e.g. Mother, Father, Grandparent. Default: Parent"),
});

export const personInput = z.object({
  name: z.string().max(4000).optional().describe("Full name (\"Maya Rivera\"). Alternatively give firstName/lastName."),
  firstName: z.string().max(4000).optional(),
  lastName: z.string().max(4000).optional(),
  email: z.string().max(4000).email().nullish().describe("With the first name, the matching key: an existing person with this email AND first name is updated instead of duplicated (families may share an email)"),
  phone: z.string().max(4000).nullish(),
  isMinor: z.boolean().optional().describe("Under 18. Minors are usually reached through their guardians."),
  birthYear: z.number().int().nullish(),
  notes: z.string().max(4000).nullish(),
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
  // Families share one email (siblings, a parent and a kid), so an email alone never identifies a
  // person: match email AND first name (same rule as audition casting). An email match never
  // renames anyone.
  let hit: PersonRow | undefined;
  if (email) {
    const sameEmail = all.filter((p) => norm(p.email) === email && norm(p.firstName) === norm(firstName));
    const exact = sameEmail.length > 1 ? sameEmail.filter((p) => norm(personName(p)) === norm(full)) : sameEmail;
    if (exact.length > 1) fail(`"${full}" <${email}> matches ${exact.length} people; use their id.`);
    hit = exact[0];
  }
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
  // Names are the identity here — never rewritten by an upsert. Fill a missing last name / email only.
  if (!hit.lastName && lastName) set.lastName = lastName;
  if (email && !hit.email) set.email = email;
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
    // A kid listed with a parent's email: the email is the parent's. Don't store or match it on the kid.
    const guardianEmails = new Set((input.guardians ?? []).map((g) => (g.email ? normalizeEmail(g.email) : "")).filter(Boolean));
    const ownEmail = input.email ? normalizeEmail(input.email) : null;
    const personInputClean = ownEmail && guardianEmails.has(ownEmail) ? { ...input, email: null } : input;
    const { row, created } = await upsertOne(ctx, pool, personInputClean, q);
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
  person: z.string().max(4000).describe("Person id, email, or exact full name"),
  role: z.string().max(4000).describe("Role name or id"),
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

export async function unassignRole(ctx: Ctx, productionId: string, personRef: string, roleRef: string, q: Q = db) {
  const person = matchPerson(await loadOrgPeople(ctx, q), personRef) ?? fail(`No person "${personRef}".`);
  const [role] = requireRoles(await loadRoles(productionId, q), [roleRef], "unassign_role");
  const del = await q
    .delete(roleAssignments)
    .where(and(eq(roleAssignments.roleId, role.id), eq(roleAssignments.personId, person.id)))
    .returning();
  if (del.length) await dropPersonCallsIfUncast(q, productionId, person.id);
  return { removed: del.length > 0, person: personName(person), role: role.name };
}
