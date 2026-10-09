import "server-only";
import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { invites, organizations, people, productions, roleAssignments, roles } from "@/db/schema";
import { getUserOrgs } from "@/lib/access";
import { requireUser, type SessionUser } from "@/lib/auth";
import { inviteUrl } from "@/lib/invites";

export type Org = Awaited<ReturnType<typeof getUserOrgs>>[number]["org"];

/** Orgs this user administers (platform admins administer all). */
export async function getAdminOrgs(user: SessionUser): Promise<Org[]> {
  return (await getUserOrgs(user)).filter((o) => o.role === "admin").map((o) => o.org);
}

/**
 * The org the Company area is showing: ?org=<id> if the user admins it, else their first.
 * 404 when the user admins nothing.
 */
export async function resolveAdminOrg(orgParam: string | string[] | undefined) {
  const user = await requireUser();
  const orgs = await getAdminOrgs(user);
  if (orgs.length === 0) notFound();
  const wanted = typeof orgParam === "string" ? orgParam : undefined;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0];
  return { user, org, orgs };
}

/** Append ?org= so multi-org admins stay in the org they picked. */
export function orgHref(path: string, orgId: string, extra?: Record<string, string>) {
  const qs = new URLSearchParams({ org: orgId, ...extra });
  return `${path}?${qs.toString()}`;
}

export function personName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** Split "Maya Rivera" / "Mary Jo van Dyke" into first + last. */
export function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() ?? "";
  return { firstName, lastName: parts.join(" ") };
}

/** Roles a person holds in productions that aren't closed, most recent production first. */
export async function currentRoles(personId: string) {
  return db
    .select({ productionId: productions.id, production: productions.title, role: roles.name, kind: roleAssignments.kind })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(productions, eq(productions.id, roles.productionId))
    .where(and(eq(roleAssignments.personId, personId), ne(productions.status, "closed")))
    .orderBy(desc(productions.createdAt));
}

/** The prewritten text an admin sends with an invite link (editable before sharing). */
export function inviteMessage(args: {
  orgName: string;
  url: string;
  wardFirstName?: string | null;
  isSelf?: boolean;
  productionTitle?: string | null;
  creativeTitle?: string | null;
}) {
  const forShow = args.productionTitle ? ` for ${args.productionTitle}` : "";
  if (args.creativeTitle && args.productionTitle)
    return `You're invited to join ${args.productionTitle} on Calltime as ${args.creativeTitle}: ${args.url}`;
  if (args.wardFirstName)
    return `Join ${args.orgName} on Calltime to see ${args.wardFirstName}'s rehearsal calls${forShow}: ${args.url}`;
  if (args.isSelf) return `Join ${args.orgName} on Calltime to see your rehearsal calls${forShow}: ${args.url}`;
  return `You're invited to join ${args.orgName} on Calltime: ${args.url}`;
}

/** Build the share message for a freshly created invite. */
export async function messageForInvite(invite: typeof invites.$inferSelect, url: string) {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, invite.orgId) });
  const subjectId = invite.guardianOfPersonId ?? invite.personId;
  const [subject, castIn, prod] = await Promise.all([
    subjectId ? db.query.people.findFirst({ where: eq(people.id, subjectId) }) : undefined,
    subjectId ? currentRoles(subjectId) : [],
    invite.productionId ? db.query.productions.findFirst({ where: eq(productions.id, invite.productionId) }) : undefined,
  ]);
  return inviteMessage({
    orgName: org?.name ?? "your theater company",
    url,
    wardFirstName: invite.guardianOfPersonId ? subject?.firstName : null,
    isSelf: !!invite.personId,
    productionTitle: prod?.title ?? castIn[0]?.production ?? null,
    creativeTitle: invite.creativeTitle,
  });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pending (unaccepted, unexpired) invites for an org, with a human description of what each grants
 * and its shareable URL. Optionally narrowed to invites about one person.
 */
export async function getPendingInvites(orgId: string, aboutPersonId?: string) {
  const where = and(
    eq(invites.orgId, orgId),
    isNull(invites.acceptedAt),
    gt(invites.expiresAt, new Date()),
    aboutPersonId ? or(eq(invites.personId, aboutPersonId), eq(invites.guardianOfPersonId, aboutPersonId)) : undefined,
  );
  const rows = await db.select().from(invites).where(where).orderBy(desc(invites.createdAt));
  if (rows.length === 0) return [];

  const personIds = [...new Set(rows.flatMap((r) => [r.personId, r.guardianOfPersonId]).filter((x): x is string => !!x))];
  const prodIds = [...new Set(rows.map((r) => r.productionId).filter((x): x is string => !!x))];
  const [ppl, prods] = await Promise.all([
    personIds.length ? db.select().from(people).where(inArray(people.id, personIds)) : [],
    prodIds.length ? db.select().from(productions).where(inArray(productions.id, prodIds)) : [],
  ]);
  const pName = new Map(ppl.map((p) => [p.id, personName(p)]));
  const prodTitle = new Map(prods.map((p) => [p.id, p.title]));

  return Promise.all(
    rows.map(async (r) => {
      const grants: string[] = [];
      if (r.orgRole === "admin") grants.push("Company admin");
      if (r.productionId && r.creativeTitle) grants.push(`${r.creativeTitle}, ${prodTitle.get(r.productionId) ?? "a production"}`);
      if (r.personId) grants.push(`Account for ${pName.get(r.personId) ?? "a person"}`);
      if (r.guardianOfPersonId) grants.push(`Guardian of ${pName.get(r.guardianOfPersonId) ?? "a minor"}`);
      if (grants.length === 0) grants.push("Member");
      const url = await inviteUrl(r.token);
      return { invite: r, grants, url, message: await messageForInvite(r, url) };
    }),
  );
}
