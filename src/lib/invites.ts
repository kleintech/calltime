import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { creativeTeam, guardianships, invites, orgMembers, people, roleAssignments, roles, users } from "@/db/schema";
import { normalizeEmail, randomToken } from "./auth";
import { demoRestriction } from "./demo";
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
  // Claiming the record grants access to every production the person (and their wards) are in, so
  // the inviter must be an editor of all of them — otherwise one production's director could reach
  // another show's call sheets through a family they don't manage.
  const castIn = await db
    .selectDistinct({ productionId: roles.productionId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(inArray(roleAssignments.personId, ids));
  if (castIn.length === 0) throw new ActionError("You can only invite people cast in a production you manage.");
  const editable = await db
    .select({ productionId: creativeTeam.productionId })
    .from(creativeTeam)
    .where(and(eq(creativeTeam.userId, inviter.id), eq(creativeTeam.canEdit, true), inArray(creativeTeam.productionId, castIn.map((c) => c.productionId))));
  const editableIds = new Set(editable.map((e) => e.productionId));
  if (!castIn.every((c) => editableIds.has(c.productionId))) {
    throw new ActionError(`${person.firstName} is also in a production you don't manage, so only a company admin can send this invite.`);
  }
}

/**
 * Guardian invites (guardianOfPersonId) for a parent we already have on file. Accepting a plain
 * guardian invite creates a fresh person for the account, so if the parent is already an unlinked
 * person in the org (entered with the kid, or already a guardian of a sibling) a second parent row
 * appears: the family's calls split across two records, call sheets list them twice, imports naming
 * them fail as ambiguous. Instead, mint the invite with `personId` too, so acceptance claims that
 * record (step 4) and then adds the new guardianship to it (step 5).
 *
 * Which record qualifies — all of:
 *  - an unlinked (no account), non-minor person in `orgId` whose email is exactly the invite email;
 *  - already a guardian of someone: of the minor itself preferred, else of anyone in the org (the
 *    sibling case — the minor may have no guardians on file yet, so "shares a guardian with the
 *    minor" can't be used); an adult who merely shares the email is left alone;
 *  - exactly one such record in the chosen tier (two parent rows with the same email are a data
 *    problem for an admin to merge, not for an invite to guess at).
 * Claiming a record is gated by assertMayClaimPerson (org admin, or editor of every production the
 * record and its wards are in). Where the inviter fails that check — an editor who only manages one
 * of the family's shows, or a co-guardian inviting from their account — fall back to the plain
 * guardian invite rather than failing, so the invite still goes out.
 *
 * Never adopt a record by email at accept time: that would let any link holder take over whatever
 * record carries the invite email, including its other guardianships.
 */
export async function guardianInviteGrant(
  grant: Pick<InviteGrant, "orgId" | "email" | "invitedByUserId"> & { guardianOfPersonId: string },
): Promise<{ personId?: string }> {
  const email = normalizeEmail(grant.email);
  if (!email) return {};
  const candidates = await db
    .select({
      id: people.id,
      ofMinor: sql<boolean>`exists (select 1 from ${guardianships} where ${guardianships.guardianId} = ${people.id} and ${guardianships.minorId} = ${grant.guardianOfPersonId})`,
      ofAnyone: sql<boolean>`exists (select 1 from ${guardianships} where ${guardianships.guardianId} = ${people.id})`,
    })
    .from(people)
    .where(
      and(
        eq(people.orgId, grant.orgId),
        isNull(people.userId),
        eq(people.isMinor, false),
        ne(people.id, grant.guardianOfPersonId),
        sql`lower(${people.email}) = ${email}`,
      ),
    );
  const tier = [candidates.filter((c) => c.ofMinor), candidates.filter((c) => c.ofAnyone)].find((t) => t.length > 0);
  if (!tier || tier.length !== 1) return {};
  const personId = tier[0].id;
  try {
    await assertMayClaimPerson({ ...grant, email, personId });
  } catch (e) {
    if (e instanceof ActionError) return {};
    throw e;
  }
  return { personId };
}

export async function createInvite(grant: InviteGrant) {
  // Backstop for every invite path: demo accounts (which anyone on the internet can become) must
  // not address links from our domain to real inboxes. Callers check earlier for a friendly message.
  if (grant.invitedByUserId) {
    const inviter = await db.query.users.findFirst({ columns: { email: true }, where: eq(users.id, grant.invitedByUserId) });
    const restricted = inviter ? demoRestriction(inviter.email, "send invites") : null;
    if (restricted) throw new ActionError(restricted);
  }
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
