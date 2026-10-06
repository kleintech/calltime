"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { guardianships, people, roleAssignments, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";
import { createInvite } from "@/lib/invites";
import {
  ActionError,
  formAction,
  getPersonInOrg,
  getRoleInProduction,
  impactNote,
  mutateCalls,
  parseForm,
  personName,
  type FormState,
} from "@/lib/production-queries";

const opt = (n: number) =>
  z
    .string()
    .trim()
    .max(n)
    .optional()
    .transform((v) => (v ? v : null));
const optEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? normalizeEmail(v) : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email");
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "1" || v === "true");
const kindSchema = z.enum(["primary", "understudy", "swing"]);

const newPersonSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().max(80).default(""),
  email: optEmail,
  phone: opt(40),
  isMinor: checkbox,
});

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`, "layout");
}

/**
 * A person this production may manage: anyone assigned to one of its roles, or a guardian of
 * such a person. Returns the person row.
 */
async function getPersonInProduction(productionId: string, orgId: string, personId: string) {
  const person = await getPersonInOrg(orgId, personId);
  const castIds = (
    await db
      .select({ id: roleAssignments.personId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roles.productionId, productionId))
  ).map((r) => r.id);
  if (castIds.includes(person.id)) return person;
  if (castIds.length) {
    const g = await db
      .select()
      .from(guardianships)
      .where(and(eq(guardianships.guardianId, person.id), inArray(guardianships.minorId, castIds)))
      .limit(1);
    if (g.length) return person;
  }
  throw new ActionError("That person isn't in this production.");
}

/** Assign an existing org person, or a newly created one (optionally with a guardian), to a role. */
export async function assignRole(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org, user } = await requireProductionEditor(productionId);
    const base = parseForm(
      z.object({ roleId: z.string().min(1, "Choose a role"), kind: kindSchema, mode: z.enum(["existing", "new"]) }),
      fd,
    );
    const role = await getRoleInProduction(productionId, base.roleId);

    let personId: string;
    let who: string;
    if (base.mode === "existing") {
      const { personId: pid } = parseForm(z.object({ personId: z.string().min(1, "Choose a person") }), fd);
      const person = await getPersonInOrg(org.id, pid);
      personId = person.id;
      who = personName(person);
    } else {
      const p = parseForm(newPersonSchema, fd);
      const g = parseForm(
        z.object({
          guardianFirstName: opt(80),
          guardianLastName: opt(80),
          guardianEmail: optEmail,
          guardianPhone: opt(40),
        }),
        fd,
      );
      const wantsGuardian = p.isMinor && !!(g.guardianFirstName || g.guardianEmail);
      if (wantsGuardian && !g.guardianFirstName) throw new ActionError("Guardian first name is required.");
      personId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(people)
          .values({ orgId: org.id, ...p })
          .returning({ id: people.id });
        if (wantsGuardian) {
          const [gRow] = await tx
            .insert(people)
            .values({
              orgId: org.id,
              firstName: g.guardianFirstName!,
              lastName: g.guardianLastName ?? p.lastName,
              email: g.guardianEmail,
              phone: g.guardianPhone,
            })
            .returning({ id: people.id });
          await tx.insert(guardianships).values({ guardianId: gRow.id, minorId: row.id });
        }
        return row.id;
      });
      who = personName(p);
    }

    const { affected } = await mutateCalls(productionId, user.id, (tx) =>
      tx
        .insert(roleAssignments)
        .values({ roleId: role.id, personId, kind: base.kind })
        .onConflictDoUpdate({ target: [roleAssignments.roleId, roleAssignments.personId], set: { kind: base.kind } }),
    );
    revalidate(productionId);
    return {
      message: `${who} cast as ${role.name}${base.kind === "primary" ? "" : ` (${base.kind})`}.${impactNote(affected)}`,
    };
  });
}

export async function setAssignmentKind(productionId: string, roleId: string, personId: string, fd: FormData) {
  const { user } = await requireProductionEditor(productionId);
  await getRoleInProduction(productionId, roleId);
  const kind = kindSchema.parse(fd.get("kind"));
  // Understudies aren't called by scene/group calls, so a kind change can change someone's call.
  await mutateCalls(productionId, user.id, (tx) =>
    tx
      .update(roleAssignments)
      .set({ kind })
      .where(and(eq(roleAssignments.roleId, roleId), eq(roleAssignments.personId, personId))),
  );
  revalidate(productionId);
}

export async function removeAssignment(productionId: string, roleId: string, personId: string) {
  const { user } = await requireProductionEditor(productionId);
  await getRoleInProduction(productionId, roleId);
  await mutateCalls(productionId, user.id, (tx) =>
    tx.delete(roleAssignments).where(and(eq(roleAssignments.roleId, roleId), eq(roleAssignments.personId, personId))),
  );
  revalidate(productionId);
}

/** Add a role to a person from their detail page. */
export async function addRoleToPerson(productionId: string, personId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org, user } = await requireProductionEditor(productionId);
    const person = await getPersonInOrg(org.id, personId);
    const { roleId, kind } = parseForm(z.object({ roleId: z.string().min(1, "Choose a role"), kind: kindSchema }), fd);
    const role = await getRoleInProduction(productionId, roleId);
    const { affected } = await mutateCalls(productionId, user.id, (tx) =>
      tx
        .insert(roleAssignments)
        .values({ roleId: role.id, personId: person.id, kind })
        .onConflictDoUpdate({ target: [roleAssignments.roleId, roleAssignments.personId], set: { kind } }),
    );
    revalidate(productionId);
    return { message: `Added ${role.name}.${impactNote(affected)}` };
  });
}

export async function updatePerson(productionId: string, personId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org } = await requireProductionEditor(productionId);
    await getPersonInProduction(productionId, org.id, personId);
    const data = parseForm(newPersonSchema, fd);
    await db.update(people).set(data).where(eq(people.id, personId));
    revalidate(productionId);
    return { message: "Saved." };
  });
}

export async function addGuardian(productionId: string, minorId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org } = await requireProductionEditor(productionId);
    const minor = await getPersonInProduction(productionId, org.id, minorId);
    const { mode, relationship } = parseForm(
      z.object({ mode: z.enum(["existing", "new"]), relationship: z.string().trim().max(40).optional() }),
      fd,
    );
    let guardianId: string;
    if (mode === "existing") {
      const { guardianId: gid } = parseForm(z.object({ guardianId: z.string().min(1, "Choose a person") }), fd);
      const g = await getPersonInOrg(org.id, gid);
      if (g.id === minor.id) throw new ActionError("Someone can't be their own guardian.");
      guardianId = g.id;
    } else {
      const g = parseForm(
        z.object({ firstName: z.string().trim().min(1, "Required").max(80), lastName: opt(80), email: optEmail, phone: opt(40) }),
        fd,
      );
      const [row] = await db
        .insert(people)
        .values({ orgId: org.id, firstName: g.firstName, lastName: g.lastName ?? minor.lastName, email: g.email, phone: g.phone })
        .returning({ id: people.id });
      guardianId = row.id;
    }
    await db
      .insert(guardianships)
      .values({ guardianId, minorId: minor.id, relationship: relationship || "Parent" })
      .onConflictDoUpdate({
        target: [guardianships.guardianId, guardianships.minorId],
        set: { relationship: relationship || "Parent" },
      });
    revalidate(productionId);
    return { message: "Guardian added." };
  });
}

export async function removeGuardian(productionId: string, minorId: string, guardianId: string) {
  const { org } = await requireProductionEditor(productionId);
  await getPersonInProduction(productionId, org.id, minorId);
  await db.delete(guardianships).where(and(eq(guardianships.minorId, minorId), eq(guardianships.guardianId, guardianId)));
  revalidate(productionId);
}

/**
 * Invite link that attaches a new account to an existing person record (a performer or a guardian
 * we already have on file). Guardianships already recorded carry over automatically.
 */
export async function invitePerson(productionId: string, personId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org, user, production } = await requireProductionEditor(productionId);
    const person = await getPersonInProduction(productionId, org.id, personId);
    if (person.userId) throw new ActionError(`${personName(person)} already has an account.`);
    const { email } = parseForm(z.object({ email: optEmail }), fd);
    if (!email) throw new ActionError("Enter the email they'll sign in with.");
    if (!person.email) await db.update(people).set({ email }).where(eq(people.id, person.id));
    const { url } = await createInvite({
      orgId: org.id,
      email,
      name: personName(person),
      personId: person.id,
      invitedByUserId: user.id,
    });
    revalidate(productionId);
    return {
      inviteUrl: url,
      shareText: await inviteMessage(productionId, org.name, production.title, person),
      message: `Invite link for ${personName(person)} is ready. Send it by text or email.`,
    };
  });
}

/** Prewritten invite text naming the kid(s) or the role, so the recipient knows why they got it. */
async function inviteMessage(
  productionId: string,
  orgName: string,
  title: string,
  person: typeof people.$inferSelect,
) {
  const castRows = await db
    .select({ personId: roleAssignments.personId, roleName: roles.name, kind: roleAssignments.kind })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roles.productionId, productionId));
  const ownRoles = castRows.filter((r) => r.personId === person.id && r.kind === "primary").map((r) => r.roleName);
  const wardIds = new Set(castRows.map((r) => r.personId));
  const wards = (
    await db
      .select({ minor: people })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.minorId))
      .where(eq(guardianships.guardianId, person.id))
  ).filter((w) => wardIds.has(w.minor.id));
  if (wards.length) {
    const names = wards.map((w) => w.minor.firstName);
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0];
    return `Hi ${person.firstName}! Join ${orgName} on Calltime to see ${who}'s rehearsal calls for ${title}. They'll go straight into your phone's calendar:`;
  }
  if (ownRoles.length) {
    return `Hi ${person.firstName}! You're cast as ${ownRoles.join(" & ")} in ${title}. Join Calltime to see your rehearsal calls:`;
  }
  return `Hi ${person.firstName}! Join ${orgName} on Calltime to see your rehearsal calls for ${title}:`;
}
