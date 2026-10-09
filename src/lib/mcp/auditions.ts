import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditionSignups, auditionSlots, auditions, productions, roles, signupStatus } from "@/db/schema";
import { type Ctx, fail, getProduction, isUuid, local } from "./util";

export const SIGNUP_STATUSES = signupStatus.enumValues;
type SignupStatus = (typeof SIGNUP_STATUSES)[number];

async function getAudition(ctx: Ctx, id: string) {
  if (!isUuid(id)) fail(`Audition ids are UUIDs; got "${id}". Use list_auditions.`);
  const rows = await db
    .select({ audition: auditions, production: productions })
    .from(auditions)
    .innerJoin(productions, eq(productions.id, auditions.productionId))
    .where(and(eq(auditions.id, id), eq(productions.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? fail(`No audition ${id} in ${ctx.orgName}.`);
}

export async function listAuditions(ctx: Ctx, production?: string) {
  const conds = [eq(productions.orgId, ctx.orgId)];
  if (production) conds.push(eq(productions.id, (await getProduction(ctx, production)).id));
  const rows = await db
    .select({ a: auditions, title: productions.title })
    .from(auditions)
    .innerJoin(productions, eq(productions.id, auditions.productionId))
    .where(and(...conds));
  const ids = rows.map((r) => r.a.id);
  const [slotRows, statusRows] = ids.length
    ? await Promise.all([
        db.select().from(auditionSlots).where(inArray(auditionSlots.auditionId, ids)).orderBy(asc(auditionSlots.startsAt)),
        db
          .select({ id: auditionSignups.auditionId, status: auditionSignups.status, n: count() })
          .from(auditionSignups)
          .where(inArray(auditionSignups.auditionId, ids))
          .groupBy(auditionSignups.auditionId, auditionSignups.status),
      ])
    : [[], []];
  return {
    timezone: ctx.timezone,
    auditions: rows.map(({ a, title }) => ({
      id: a.id,
      production: title,
      title: a.title,
      isOpen: a.isOpen,
      publicSignupPath: `/audition/${a.slug}`,
      location: a.location ?? undefined,
      slots: slotRows
        .filter((s) => s.auditionId === a.id)
        .map((s) => ({ id: s.id, kind: s.kind, label: s.label ?? undefined, start: local(s.startsAt, ctx.timezone), end: local(s.endsAt, ctx.timezone), capacity: s.capacity })),
      signupsByStatus: Object.fromEntries(statusRows.filter((s) => s.id === a.id).map((s) => [s.status, s.n])),
    })),
  };
}

export async function listSignups(ctx: Ctx, auditionId: string, status?: SignupStatus) {
  const { audition, production } = await getAudition(ctx, auditionId);
  const conds = [eq(auditionSignups.auditionId, audition.id)];
  if (status) conds.push(eq(auditionSignups.status, status));
  const rows = await db.select().from(auditionSignups).where(and(...conds)).orderBy(asc(auditionSignups.lastName));
  const roleRows = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.productionId, production.id));
  const roleName = new Map(roleRows.map((r) => [r.id, r.name]));
  return {
    audition: audition.title,
    production: production.title,
    signups: rows.map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      email: s.email,
      age: s.age ?? undefined,
      guardian: s.guardianName ? { name: s.guardianName, email: s.guardianEmail ?? undefined, phone: s.guardianPhone ?? undefined } : undefined,
      status: s.status,
      rolesInterested: s.rolesInterested ?? undefined,
      experience: s.experience ?? undefined,
      conflicts: s.conflictsText ?? undefined,
      rating: s.rating ?? undefined,
      staffNotes: s.staffNotes ?? undefined,
      callbackRoles: s.callbackRoleIds.map((id) => roleName.get(id) ?? id),
      personId: s.personId ?? undefined,
    })),
  };
}

export async function setSignupStatus(
  ctx: Ctx,
  input: { signups: string[]; status: SignupStatus; staffNotes?: string; rating?: number },
) {
  if (input.signups.some((id) => !isUuid(id))) fail("Signup ids are UUIDs; use list_audition_signups.");
  const rows = await db
    .select({ id: auditionSignups.id, notes: auditionSignups.staffNotes })
    .from(auditionSignups)
    .innerJoin(auditions, eq(auditions.id, auditionSignups.auditionId))
    .innerJoin(productions, eq(productions.id, auditions.productionId))
    .where(and(inArray(auditionSignups.id, input.signups), eq(productions.orgId, ctx.orgId)));
  const found = new Set(rows.map((r) => r.id));
  const missing = input.signups.filter((id) => !found.has(id));
  if (missing.length) fail(`Signup(s) not found in ${ctx.orgName}: ${missing.join(", ")}`);
  const set: Partial<typeof auditionSignups.$inferInsert> = { status: input.status };
  if (input.rating !== undefined) set.rating = input.rating;
  if (input.staffNotes !== undefined) set.staffNotes = input.staffNotes;
  await db.update(auditionSignups).set(set).where(inArray(auditionSignups.id, [...found]));
  return {
    updated: rows.length,
    status: input.status,
    note:
      input.status === "cast"
        ? "Status only. To put them in the show, add them with upsert_people and assign_roles (or import_production)."
        : undefined,
  };
}
