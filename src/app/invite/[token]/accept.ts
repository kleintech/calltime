import "server-only";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  changeAcks,
  creativeTeam,
  eventChanges,
  events,
  guardianships,
  invites,
  orgMembers,
  organizations,
  people,
  productions,
  users,
} from "@/db/schema";
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

    // People this account already covered in the org, so only what this invite adds gets pre-acked below.
    const coveredBefore = await coveredPeopleInOrg(tx, invite.orgId, userId);

    /* 4. Become this person — only the record the invite names explicitly, only if unclaimed, and only
     *    if its email still matches the invite (createInvite enforces this at creation too). */
    let claimed: typeof people.$inferSelect | undefined;
    if (invite.personId) {
      const person = await tx.query.people.findFirst({
        where: and(eq(people.id, invite.personId), eq(people.orgId, invite.orgId), isNull(people.userId)),
      });
      if (person && (!person.email || normalizeEmail(person.email) === normalizeEmail(invite.email))) {
        const [row] = await tx
          .update(people)
          .set({ userId })
          .where(and(eq(people.id, person.id), isNull(people.userId)))
          .returning();
        claimed = row;
      }
    }

    /* 5. Guardian of a person: the record step 4 just claimed (a guardian invite minted with personId
     *    by guardianInviteGrant — the parent was already on file), else the user's OWN already-linked
     *    person in this org, else a fresh one. Never adopt an existing record by email match here —
     *    that would hand over its other guardianships to whoever holds the link. */
    if (invite.guardianOfPersonId) {
      const minor = await tx.query.people.findFirst({
        where: and(eq(people.id, invite.guardianOfPersonId), eq(people.orgId, invite.orgId)),
      });
      if (minor) {
        let self =
          claimed ?? (await tx.query.people.findFirst({ where: and(eq(people.orgId, invite.orgId), eq(people.userId, userId)) }));
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

    /* 6. Changes recorded before this account covered these people aren't news to it: a new guardian's
     *    first screen shouldn't open on "1 change to check" about a rehearsal moved last month. Mark
     *    every change affecting the people this invite newly covers (on events still to come) as seen,
     *    without touching acks for people the account already covered. */
    const gained = [...(await coveredPeopleInOrg(tx, invite.orgId, userId))].filter((id) => !coveredBefore.has(id));
    if (gained.length) await ackEarlierChanges(tx, userId, gained);

    return { userId, invite };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The user's own person records in the org plus their wards (same shape as getCoveredPersonIds, in a transaction). */
async function coveredPeopleInOrg(tx: Tx, orgId: string, userId: string) {
  const own = (await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), eq(people.userId, userId)))).map(
    (p) => p.id,
  );
  if (own.length === 0) return new Set<string>();
  const wards = await tx.select({ id: guardianships.minorId }).from(guardianships).where(inArray(guardianships.guardianId, own));
  return new Set([...own, ...wards.map((w) => w.id)]);
}

/**
 * Acknowledge, for `userId`, the latest change revision of every event (not yet ended) whose changes
 * affected any of `personIds`. Same upsert shape as `acknowledge` in src/lib/changes.ts: never moves
 * an existing ack backwards.
 */
async function ackEarlierChanges(tx: Tx, userId: string, personIds: string[]) {
  const latest = await tx
    .select({ eventId: eventChanges.eventId, revision: sql<number>`max(${eventChanges.revision})`.mapWith(Number) })
    .from(eventChanges)
    .innerJoin(events, eq(events.id, eventChanges.eventId))
    .where(
      and(
        sql`${eventChanges.affectedPersonIds} ?| array[${sql.join(personIds.map((id) => sql`${id}`), sql`, `)}]::text[]`,
        gt(events.endsAt, new Date()),
      ),
    )
    .groupBy(eventChanges.eventId);
  if (latest.length === 0) return;
  const now = new Date();
  await tx
    .insert(changeAcks)
    .values(latest.map((l) => ({ userId, eventId: l.eventId, revision: l.revision, ackedAt: now })))
    .onConflictDoUpdate({
      target: [changeAcks.userId, changeAcks.eventId],
      set: { revision: sql`excluded.revision`, ackedAt: now },
      setWhere: sql`${changeAcks.revision} < excluded.revision`,
    });
}

/** Where to land after accepting: staff go to their production / company, families to their calls. */
export function landingFor(invite: InviteRow) {
  if (invite.personId || invite.guardianOfPersonId) return "/home";
  if (invite.productionId && invite.creativeTitle) return `/p/${invite.productionId}/schedule`;
  if (invite.orgRole === "admin") return `/org?org=${invite.orgId}`;
  return "/home";
}
