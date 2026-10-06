import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import {
  creativeTeam,
  guardianships,
  orgMembers,
  organizations,
  people,
  productions,
  roleAssignments,
  roles,
} from "@/db/schema";
import { requireUser, type SessionUser } from "./auth";

/**
 * Permission model
 * - Platform admin (users.isPlatformAdmin): everything, plus /admin (tenants).
 * - Org admin (orgMembers.role = admin): manage the org's productions, people, members, API keys.
 * - Creative team (creativeTeam row, canEdit): edit one production (scenes, roles, cast, schedule, auditions).
 * - Cast / guardian: read their own production view and calls for the people they "cover".
 *
 * A user "covers" a person when people.userId = user.id (themselves) or they are that
 * person's guardian (guardianships.guardianId → a people row whose userId = user.id).
 */

export type ProductionAccess = {
  production: typeof productions.$inferSelect;
  org: typeof organizations.$inferSelect;
  canEdit: boolean; // creative team w/ edit, org admin, or platform admin
  isOrgAdmin: boolean;
  creativeTitle: string | null;
};

export const getOrgRole = cache(async (userId: string, orgId: string) => {
  const row = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)),
  });
  return row?.role ?? null;
});

/** People ids this user can see calls for: their own person records plus their wards. */
export const getCoveredPersonIds = cache(async (userId: string): Promise<string[]> => {
  const own = await db.select({ id: people.id }).from(people).where(eq(people.userId, userId));
  const ownIds = own.map((p) => p.id);
  if (ownIds.length === 0) return [];
  const wards = await db
    .select({ id: guardianships.minorId })
    .from(guardianships)
    .where(inArray(guardianships.guardianId, ownIds));
  return [...new Set([...ownIds, ...wards.map((w) => w.id)])];
});

/** Resolve access to a production for a user, or null if they have none. */
export const getProductionAccess = cache(
  async (user: SessionUser, productionId: string): Promise<ProductionAccess | null> => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productionId)) return null;
    const production = await db.query.productions.findFirst({ where: eq(productions.id, productionId) });
    if (!production) return null;
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, production.orgId) });
    if (!org) return null;

    const orgRole = await getOrgRole(user.id, org.id);
    const isOrgAdmin = user.isPlatformAdmin || orgRole === "admin";
    const ct = await db.query.creativeTeam.findFirst({
      where: and(eq(creativeTeam.productionId, productionId), eq(creativeTeam.userId, user.id)),
    });
    const canEdit = isOrgAdmin || !!ct?.canEdit;

    if (!canEdit && !ct) {
      // Cast/guardian: must cover someone assigned to a role in this production.
      const covered = await getCoveredPersonIds(user.id);
      if (covered.length === 0) return null;
      const hit = await db
        .select({ personId: roleAssignments.personId })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(and(eq(roles.productionId, productionId), inArray(roleAssignments.personId, covered)))
        .limit(1);
      if (hit.length === 0) return null;
    }
    return { production, org, canEdit, isOrgAdmin, creativeTitle: ct?.title ?? null };
  },
);

/** For pages: any access, else 404. */
export async function requireProductionAccess(productionId: string) {
  const user = await requireUser();
  const access = await getProductionAccess(user, productionId);
  if (!access) notFound();
  return { user, ...access };
}

/** For pages and actions that modify a production. Throws (actions) / redirects (pages). */
export async function requireProductionEditor(productionId: string) {
  const ctx = await requireProductionAccess(productionId);
  if (!ctx.canEdit) redirect(`/p/${productionId}`);
  return ctx;
}

/** For org admin pages: user must be org admin (or platform admin). */
export async function requireOrgAdmin(orgId: string) {
  const user = await requireUser();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) notFound();
  const role = await getOrgRole(user.id, orgId);
  if (!user.isPlatformAdmin && role !== "admin") notFound();
  return { user, org };
}

/** Orgs the user belongs to (any role), with their role. Platform admins see all orgs. */
export async function getUserOrgs(user: SessionUser) {
  if (user.isPlatformAdmin) {
    const all = await db.select().from(organizations).orderBy(organizations.name);
    return all.map((org) => ({ org, role: "admin" as const }));
  }
  const rows = await db
    .select({ org: organizations, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, user.id))
    .orderBy(organizations.name);
  return rows;
}

/**
 * Productions visible to the user, with how they relate to each.
 * relation: "admin" (org admin), "creative" (on creative team), "cast" (covers a cast member).
 */
export async function getUserProductions(user: SessionUser) {
  const result = new Map<
    string,
    { production: typeof productions.$inferSelect; relation: "admin" | "creative" | "cast"; title?: string }
  >();

  const orgs = await getUserOrgs(user);
  const adminOrgIds = orgs.filter((o) => o.role === "admin").map((o) => o.org.id);
  if (adminOrgIds.length) {
    const rows = await db.select().from(productions).where(inArray(productions.orgId, adminOrgIds));
    for (const p of rows) result.set(p.id, { production: p, relation: "admin" });
  }

  const ct = await db
    .select({ production: productions, title: creativeTeam.title })
    .from(creativeTeam)
    .innerJoin(productions, eq(productions.id, creativeTeam.productionId))
    .where(eq(creativeTeam.userId, user.id));
  for (const r of ct) result.set(r.production.id, { production: r.production, relation: "creative", title: r.title });

  const covered = await getCoveredPersonIds(user.id);
  if (covered.length) {
    const cast = await db
      .selectDistinct({ production: productions })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(productions, eq(productions.id, roles.productionId))
      .where(inArray(roleAssignments.personId, covered));
    for (const r of cast) if (!result.has(r.production.id)) result.set(r.production.id, { production: r.production, relation: "cast" });
  }

  return [...result.values()].sort((a, b) => a.production.title.localeCompare(b.production.title));
}
