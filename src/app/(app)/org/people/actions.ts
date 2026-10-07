"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { guardianships, people } from "@/db/schema";
import { requireOrgAdmin } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";
import { demoRestriction } from "@/lib/demo";
import { createInvite, guardianInviteGrant } from "@/lib/invites";
import { ActionError, deleteCallsTargeting } from "@/lib/production-queries";
import { firstIssue, type FormState } from "../_components/form-state";
import { messageForInvite, personName, splitName } from "../_lib/org";

const uuid = z.uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();
const optEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : normalizeEmail(v)))
  .pipe(z.email("Enter a valid email address.").nullable());

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Load a person and authorize the caller as an admin of the person's org. */
async function authorizePerson(personId: unknown) {
  const id = uuid.parse(personId);
  const person = await db.query.people.findFirst({ where: eq(people.id, id) });
  if (!person) throw new Error("Person not found");
  const { user } = await requireOrgAdmin(person.orgId);
  return { user, person };
}

function revalidatePeople(...personIds: string[]) {
  revalidatePath("/org/people");
  revalidatePath("/org");
  for (const id of personIds) revalidatePath(`/org/people/${id}`);
}

const personSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(80),
  lastName: z.string().trim().max(80),
  email: optEmail,
  phone: optText(40),
  isMinor: z.boolean(),
  birthYear: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(1900, "Birth year looks off.").max(new Date().getFullYear(), "Birth year looks off.").nullable()),
  notes: optText(2000),
});

function readPerson(fd: FormData) {
  return personSchema.safeParse({
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    isMinor: fd.get("isMinor") === "on",
    birthYear: str(fd, "birthYear"),
    notes: str(fd, "notes"),
  });
}

export async function createPerson(_: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid.parse(fd.get("orgId"));
  await requireOrgAdmin(orgId);
  const parsed = readPerson(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  // Optional guardian, asked inline for minors so the family can be invited right away.
  const gName = str(fd, "guardianName").trim();
  const guardian = parsed.data.isMinor && gName
    ? guardianSchema.safeParse({ name: gName, email: str(fd, "guardianEmail"), phone: "", relationship: "" })
    : null;
  if (guardian && !guardian.success) return { error: firstIssue(guardian.error) };
  const [row] = await db
    .insert(people)
    .values({ orgId, ...parsed.data })
    .returning();
  if (guardian?.success) await linkOrCreateGuardian(row, guardian.data);
  revalidatePeople();
  redirect(`/org/people/${row.id}`);
}

export async function updatePerson(_: FormState, fd: FormData): Promise<FormState> {
  const { user, person } = await authorizePerson(fd.get("personId"));
  const parsed = readPerson(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  // The email on file decides who may claim this record; demo admins may fill a blank, not replace.
  if (person.email && parsed.data.email !== normalizeEmail(person.email)) {
    const restricted = demoRestriction(user.email, "change email addresses");
    if (restricted) return { error: restricted };
  }
  await db.update(people).set(parsed.data).where(eq(people.id, person.id));
  revalidatePeople(person.id);
  return { ok: "Saved." };
}

export async function deletePerson(fd: FormData) {
  const { person } = await authorizePerson(fd.get("personId"));
  await db.transaction(async (tx) => {
    await deleteCallsTargeting("person", person.id, tx);
    await tx.delete(people).where(eq(people.id, person.id));
  });
  revalidatePeople();
  redirect(`/org/people?org=${person.orgId}`);
}

export async function unlinkAccount(fd: FormData) {
  const { person } = await authorizePerson(fd.get("personId"));
  await db.update(people).set({ userId: null }).where(eq(people.id, person.id));
  revalidatePeople(person.id);
}

const relationship = z.string().trim().max(40).transform((v) => v || "Parent");

const guardianSchema = z.object({
  name: z.string().trim().min(1, "Enter the guardian's name.").max(120),
  email: optEmail,
  phone: optText(40),
  relationship,
});

/** Reuse an org person with this email (never the minor themself), else create one; then link. */
async function linkOrCreateGuardian(minor: typeof people.$inferSelect, g: z.infer<typeof guardianSchema>) {
  let guardian = g.email
    ? await db.query.people.findFirst({
        where: and(eq(people.orgId, minor.orgId), sql`lower(${people.email}) = ${g.email}`, ne(people.id, minor.id)),
      })
    : undefined;
  if (!guardian) {
    [guardian] = await db
      .insert(people)
      .values({ orgId: minor.orgId, ...splitName(g.name), email: g.email, phone: g.phone })
      .returning();
  }
  await db
    .insert(guardianships)
    .values({ guardianId: guardian.id, minorId: minor.id, relationship: g.relationship })
    .onConflictDoUpdate({ target: [guardianships.guardianId, guardianships.minorId], set: { relationship: g.relationship } });
  return guardian;
}

/** Add a guardian by name + email: reuses an org person with that email, else creates one. */
export async function addGuardian(_: FormState, fd: FormData): Promise<FormState> {
  const { person: minor } = await authorizePerson(fd.get("personId"));
  const parsed = guardianSchema.safeParse({
    name: str(fd, "name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    relationship: str(fd, "relationship"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const guardian = await linkOrCreateGuardian(minor, parsed.data);
  revalidatePeople(minor.id, guardian.id);
  return { ok: `${personName(guardian)} added as ${personName(minor)}'s guardian.` };
}

/** Link two existing people: fd.personId is the page's person, fd.otherId the picked one, fd.as = guardian|ward. */
export async function linkPerson(_: FormState, fd: FormData): Promise<FormState> {
  const { person } = await authorizePerson(fd.get("personId"));
  const otherId = z.uuid("Pick someone.").safeParse(fd.get("otherId"));
  if (!otherId.success) return { error: "Pick someone from the list." };
  const as = z.enum(["guardian", "ward"]).parse(fd.get("as"));
  const rel = relationship.parse(str(fd, "relationship"));
  const other = await db.query.people.findFirst({ where: and(eq(people.id, otherId.data), eq(people.orgId, person.orgId)) });
  if (!other || other.id === person.id) return { error: "Pick someone else from this company." };
  const pair = as === "guardian" ? { guardianId: other.id, minorId: person.id } : { guardianId: person.id, minorId: other.id };
  await db
    .insert(guardianships)
    .values({ ...pair, relationship: rel })
    .onConflictDoUpdate({ target: [guardianships.guardianId, guardianships.minorId], set: { relationship: rel } });
  revalidatePeople(person.id, other.id);
  return {
    ok: as === "guardian" ? `${personName(other)} is now a guardian.` : `${personName(person)} now covers ${personName(other)}.`,
  };
}

export async function removeGuardianship(fd: FormData) {
  const ids = z.object({ guardianId: uuid, minorId: uuid }).parse({ guardianId: fd.get("guardianId"), minorId: fd.get("minorId") });
  const minor = await db.query.people.findFirst({ where: eq(people.id, ids.minorId) });
  if (!minor) return;
  await requireOrgAdmin(minor.orgId);
  // The guardian must be in the same org (guardianships don't carry orgId).
  const guardian = await db.query.people.findFirst({ where: and(eq(people.id, ids.guardianId), eq(people.orgId, minor.orgId)) });
  if (!guardian) return;
  await db.delete(guardianships).where(and(eq(guardianships.guardianId, guardian.id), eq(guardianships.minorId, minor.id)));
  revalidatePeople(minor.id, guardian.id);
}

/** Invite link that makes the recipient's account *be* this person (adults, teens, guardians on file). */
export async function invitePerson(_: FormState, fd: FormData): Promise<FormState> {
  const { user, person } = await authorizePerson(fd.get("personId"));
  if (person.userId) return { error: `${personName(person)} already has an account.` };
  const restricted = demoRestriction(user.email, "send invites");
  if (restricted) return { error: restricted };
  const email = optEmail.safeParse(str(fd, "email"));
  if (!email.success || !email.data) return { error: "Enter the email address they'll sign in with." };
  if (!person.email) await db.update(people).set({ email: email.data }).where(and(eq(people.id, person.id), isNull(people.email)));
  if (person.email && normalizeEmail(person.email) !== email.data) {
    return { error: `Use the email on file (${person.email}), or update it under Details first.` };
  }
  let created;
  try {
    created = await createInvite({
      orgId: person.orgId,
      email: email.data,
      name: personName(person),
      personId: person.id,
      invitedByUserId: user.id,
    });
  } catch (e) {
    if (e instanceof ActionError) return { error: e.message };
    throw e;
  }
  const { invite, url } = created;
  revalidatePeople(person.id);
  return { ok: `Invite link for ${personName(person)}`, link: url, message: await messageForInvite(invite, url) };
}

/**
 * Invite link for a guardian of this (minor) person. Their person record is created on accept —
 * unless the guardian is already on file unlinked under this email, in which case the invite claims
 * that record instead (see guardianInviteGrant), so one parent never becomes two.
 */
export async function inviteGuardian(_: FormState, fd: FormData): Promise<FormState> {
  const { user, person } = await authorizePerson(fd.get("personId"));
  const parsed = z
    .object({ name: z.string().trim().max(120), email: z.email("Enter the guardian's email address.") })
    .safeParse({ name: str(fd, "name"), email: normalizeEmail(str(fd, "email")) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const restricted = demoRestriction(user.email, "send invites");
  if (restricted) return { error: restricted };
  const base = { orgId: person.orgId, email: parsed.data.email, guardianOfPersonId: person.id, invitedByUserId: user.id };
  const { invite, url } = await createInvite({
    ...base,
    ...(await guardianInviteGrant(base)),
    name: parsed.data.name || null,
  });
  revalidatePeople(person.id);
  return { ok: `Guardian invite for ${personName(person)}`, link: url, message: await messageForInvite(invite, url) };
}
