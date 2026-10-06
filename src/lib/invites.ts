import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { creativeTeam, guardianships, invites, orgMembers, people, roleAssignments, roles, users } from "@/db/schema";
import { normalizeEmail, randomToken } from "./auth";
import { ActionError } from "./production-queries";

/**
 * Invitations are shareable links (/invite/<token>). There's no email provider yet, so the UI
 * shows the link with copy/share buttons; whoever creates an invite sends it however they like
 * (text, email, the old group chat).
 */
export type InviteGrant = {
  orgId: string;
  email: string;
  name?: string | null;
  orgRole?: "admin" | "member";
  productionId?: string | null;
  creativeTitle?: string | null; // joins creative team of productionId with this title
  personId?: string | null; // account becomes this person
  guardianOfPersonId?: string | null; // account becomes guardian of this person
  invitedByUserId?: string | null;
};

/**
 * An invite that claims an existing person record (personId) is the only way an account ever
 * becomes that person, and accepting it doesn't verify email ownership (we have no mailer). So:
 *  - the invite email must match the email on file, or the record must have no email yet;
 *  - the inviter must be an org admin / platform admin, or an editor of a production the person is
 *    cast in (or is a guardian of someone cast in).
 * Throws ActionError (friendly message) otherwise.
 */
async function assertMayClaimPerson(grant: InviteGrant & { personId: string }) {
  const person = await db.query.people.findFirst({ where: and(eq(people.id, grant.personId), eq(people.orgId, grant.orgId)) });
  if (!person) throw new ActionError("That person isn't in this company.");
  if (person.userId) throw new ActionError("That person already has an account.");
  const email = normalizeEmail(grant.email);
  if (person.email && normalizeEmail(person.email) !== email) {
    throw new ActionError(
      `This invite must go to the email on file for ${person.firstName} (${person.email}). Update their email first if it has changed.`,
    );
  }
  if (!grant.invitedByUserId) throw new ActionError("Only staff can invite someone to claim a person record.");
  const inviter = await db.query.users.findFirst({ where: eq(users.id, grant.invitedByUserId) });
  if (!inviter) throw new ActionError("Only staff can invite someone to claim a person record.");
  if (inviter.isPlatformAdmin) return;
  const admin = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, grant.orgId), eq(orgMembers.userId, inviter.id), eq(orgMembers.role, "admin")),
  });
  if (admin) return;
  // Editor of a production where this person (or someone they're guardian of) is cast.
  const wards = await db.select({ id: guardianships.minorId }).from(guardianships).where(eq(guardianships.guardianId, person.id));
  const ids = [person.id, ...wards.map((w) => w.id)];
  const hit = await db
    .select({ p: roles.productionId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(creativeTeam, and(eq(creativeTeam.productionId, roles.productionId), eq(creativeTeam.userId, inviter.id), eq(creativeTeam.canEdit, true)))
    .where(inArray(roleAssignments.personId, ids))
    .limit(1);
  if (hit.length === 0) throw new ActionError("You can only invite people cast in a production you manage.");
}

export async function createInvite(grant: InviteGrant) {
  if (grant.personId) await assertMayClaimPerson({ ...grant, personId: grant.personId });
  const token = randomToken(18);
  const [row] = await db
    .insert(invites)
    .values({
      token,
      orgId: grant.orgId,
      email: normalizeEmail(grant.email),
      name: grant.name ?? null,
      orgRole: grant.orgRole ?? "member",
      productionId: grant.productionId ?? null,
      creativeTitle: grant.creativeTitle ?? null,
      personId: grant.personId ?? null,
      guardianOfPersonId: grant.guardianOfPersonId ?? null,
      invitedByUserId: grant.invitedByUserId ?? null,
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    })
    .returning();
  return { invite: row, url: await inviteUrl(token) };
}

/**
 * Absolute base URL for links we hand out. APP_URL (e.g. https://calltime.app) wins when set, so a
 * spoofed Host / X-Forwarded-Host can't make us mint links to someone else's domain.
 */
export async function appBaseUrl() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteUrl(token: string) {
  return `${await appBaseUrl()}/invite/${token}`;
}
