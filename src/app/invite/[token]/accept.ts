import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creativeTeam, guardianships, invites, orgMembers, organizations, people, productions, users } from "@/db/schema";
import { hashPassword, normalizeEmail, randomToken } from "@/lib/auth";
import { currentRoles } from "@/app/(app)/org/_lib/org";

export type InviteRow = typeof invites.$inferSelect;

/** Everything the invite page needs to describe an invite. */
export async function loadInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) });
  if (!invite) return null;
  const [org, production, person, ward, inviter] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, invite.orgId) }),
    invite.productionId ? db.query.productions.findFirst({ where: eq(productions.id, invite.productionId) }) : undefined,
    invite.personId ? db.query.people.findFirst({ where: eq(people.id, invite.personId) }) : undefined,
    invite.guardianOfPersonId ? db.query.people.findFirst({ where: eq(people.id, invite.guardianOfPersonId) }) : undefined,
    invite.invitedByUserId ? db.query.users.findFirst({ where: eq(users.id, invite.invitedByUserId) }) : undefined,
  ]);
  if (!org) return null;
  const [existingUser, castIn] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.email, invite.email) }),
    invite.guardianOfPersonId ?? invite.personId ? currentRoles((invite.guardianOfPersonId ?? invite.personId)!) : [],
  ]);
  const status: "ok" | "accepted" | "expired" = invite.acceptedAt ? "accepted" : invite.expiresAt < new Date() ? "expired" : "ok";
  return { invite, org, production, person, ward, inviter, existingUser, castIn, status };
}

export class InviteError extends Error {}

/**
 * Guardian invites can be accepted by any signed-in account (a shared family device); admin seats,
 * creative seats and person-record claims are bound to the invited email.
 */
export function inviteMayBeAcceptedBy(
  invite: { email: string; orgRole: string; personId: string | null; creativeTitle: string | null },
  userEmail: string,
) {
  const bound = invite.orgRole === "admin" || !!invite.personId || !!invite.creativeTitle;
  return !bound || invite.email.toLowerCase() === userEmail.toLowerCase();
}

/**
 * Accept an invite, atomically:
 *  - as `asUserId` (signed in) or by creating / activating the account for the invite's email
 *  - org membership (never downgrades an admin), creative team seat, person link, guardianship
 * Returns the user id to start a session for.
 */
export async function acceptInvite(
  token: string,
  who: { asUserId: string } | { name: string; password: string },
): Promise<{ userId: string; invite: InviteRow }> {
  return db.transaction(async (tx) => {
    // Claim the invite first so two concurrent accepts can't both succeed.
    const [invite] = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invites.token, token), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .returning();
    if (!invite) throw new InviteError("This invite has already been used or has expired.");

    /* 1. The account */
    let user: typeof users.$inferSelect | undefined;
    if ("asUserId" in who) {
      user = await tx.query.users.findFirst({ where: eq(users.id, who.asUserId) });
      if (!user) throw new InviteError("Your session has ended. Sign in again.");
    } else {
      const email = normalizeEmail(invite.email);
      const existing = await tx.query.users.findFirst({ where: eq(users.email, email) });
      // Never take over an existing account from an invite link (we can't verify email ownership).
      if (existing) throw new InviteError("There's already an account for this email. Sign in to accept.");
      const passwordHash = await hashPassword(who.password);
      [user] = await tx.insert(users).values({ email, name: who.name, passwordHash, calendarToken: randomToken() }).returning();
    }
    const userId = user.id;

    /* 2. Org membership — upgrade member → admin, never downgrade */
    const membership = await tx.query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userId, userId)),
    });
    if (!membership) {
      await tx.insert(orgMembers).values({ orgId: invite.orgId, userId, role: invite.orgRole });
    } else if (invite.orgRole === "admin" && membership.role !== "admin") {
      await tx
        .update(orgMembers)
        .set({ role: "admin" })
        .where(and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userId, userId)));
    }

    /* 3. Creative team seat (production must belong to the invite's org) */
    if (invite.productionId && invite.creativeTitle) {
      const prod = await tx.query.productions.findFirst({
        where: and(eq(productions.id, invite.productionId), eq(productions.orgId, invite.orgId)),
      });
      if (prod) {
        await tx
          .insert(creativeTeam)
          .values({ productionId: prod.id, userId, title: invite.creativeTitle })
          .onConflictDoUpdate({ target: [creativeTeam.productionId, creativeTeam.userId], set: { title: invite.creativeTitle } });
      }
    }

    /* 4. Become this person — only the record the invite names explicitly, only if unclaimed, and only
     *    if its email still matches the invite (createInvite enforces this at creation too). */
    if (invite.personId) {
      const person = await tx.query.people.findFirst({
        where: and(eq(people.id, invite.personId), eq(people.orgId, invite.orgId), isNull(people.userId)),
      });
      if (person && (!person.email || normalizeEmail(person.email) === normalizeEmail(invite.email))) {
        await tx.update(people).set({ userId }).where(and(eq(people.id, person.id), isNull(people.userId)));
      }
    }

    /* 5. Guardian of a person: the user's OWN already-linked person in this org, else a fresh one.
     *    Never adopt an existing record by email match — that would hand over its other guardianships. */
    if (invite.guardianOfPersonId) {
      const minor = await tx.query.people.findFirst({
        where: and(eq(people.id, invite.guardianOfPersonId), eq(people.orgId, invite.orgId)),
      });
      if (minor) {
        let self = await tx.query.people.findFirst({ where: and(eq(people.orgId, invite.orgId), eq(people.userId, userId)) });
        if (!self) {
          const [first, ...rest] = user.name.trim().split(/\s+/);
          [self] = await tx
            .insert(people)
            .values({ orgId: invite.orgId, userId, firstName: first || user.name, lastName: rest.join(" "), email: user.email, phone: user.phone })
            .returning();
        }
        if (self.id !== minor.id) {
          await tx.insert(guardianships).values({ guardianId: self.id, minorId: minor.id }).onConflictDoNothing();
        }
      }
    }

    return { userId, invite };
  });
}

/** Where to land after accepting: staff go to their production / company, families to their calls. */
export function landingFor(invite: InviteRow) {
  if (invite.personId || invite.guardianOfPersonId) return "/home";
  if (invite.productionId && invite.creativeTitle) return `/p/${invite.productionId}/schedule`;
  if (invite.orgRole === "admin") return `/org?org=${invite.orgId}`;
  return "/home";
}
