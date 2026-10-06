"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditionSignups, roles } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth";
import { clientIp, takeRateLimit } from "@/lib/rate-limit";
import { getPublicAudition, insertSignupWithCapacity, isUuid, moveSignupSlot, parseConflictDates, SlotFullError } from "@/lib/auditions";
import { publicSlotOptions, type SlotOption } from "./slot-options";

export type PublicFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
  /** Fresh slot list when the chosen one filled up while they were typing. */
  slots?: SlotOption[];
};

const s = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const optionalEmail = z
  .union([z.literal(""), z.string().trim().email("Enter an email like name@example.com").max(200)])
  .transform((v) => v || null);

const signupSchema = z
  .object({
    firstName: s(80).min(1, "Enter a first name"),
    lastName: s(80).min(1, "Enter a last name"),
    email: optionalEmail,
    phone: optional(40),
    age: z.coerce.number({ message: "Enter an age" }).int("Enter a whole number").min(3, "Enter a real age").max(120, "Enter a real age"),
    guardianName: optional(160),
    guardianEmail: optionalEmail,
    guardianPhone: optional(40),
    experience: optional(4000),
    conflictsText: optional(4000),
    otherRoles: optional(300),
  })
  .superRefine((v, ctx) => {
    if (v.age < 18) {
      if (!v.guardianName) ctx.addIssue({ code: "custom", path: ["guardianName"], message: "Enter a parent or guardian's name" });
      if (!v.guardianEmail) ctx.addIssue({ code: "custom", path: ["guardianEmail"], message: "Enter a parent or guardian's email" });
      if (!v.guardianPhone) ctx.addIssue({ code: "custom", path: ["guardianPhone"], message: "Enter a phone number we can reach on audition day" });
    } else if (!v.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter an email like name@example.com" });
    }
  });

const val = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function submitSignup(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const slug = val(fd, "slug");
  const row = await getPublicAudition(slug);
  if (!row) return { error: "This audition no longer exists." };
  const { audition, production, org } = row;
  if (!audition.isOpen) return { error: "Signups for this audition are closed." };
  // Public and unauthenticated: cap signups per device and per family so nobody can fill every
  // slot by script (generous enough for a school network full of parents and for siblings).
  const limitEmail = normalizeEmail(val(fd, "guardianEmail") || val(fd, "email"));
  const limited = await takeRateLimit(
    [
      { key: `signup:ip:${await clientIp()}`, max: 25 },
      ...(limitEmail ? [{ key: `signup:${audition.id}:${limitEmail}`, max: 6 }] : []),
    ],
    "That's a lot of signups from here in a short time. Wait a few minutes and try again, or contact the company.",
  );
  if (limited) return { error: limited };

  const parsed = signupSchema.safeParse({
    firstName: val(fd, "firstName"),
    lastName: val(fd, "lastName"),
    email: val(fd, "email"),
    phone: val(fd, "phone"),
    age: val(fd, "age"),
    guardianName: val(fd, "guardianName"),
    guardianEmail: val(fd, "guardianEmail"),
    guardianPhone: val(fd, "guardianPhone"),
    experience: val(fd, "experience"),
    conflictsText: val(fd, "conflictsText"),
    otherRoles: val(fd, "otherRoles"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;
  const conflictDates = parseConflictDates(val(fd, "conflictDates"));
  if ("error" in conflictDates) return { error: conflictDates.error, fieldErrors: { conflictDates: conflictDates.error } };

  // Roles interested: checked production roles (validated against this production) + free text.
  const roleIds = fd.getAll("roles").map(String).filter(isUuid);
  const roleNames = roleIds.length
    ? (
        await db
          .select({ name: roles.name })
          .from(roles)
          .where(and(eq(roles.productionId, production.id), inArray(roles.id, roleIds)))
      ).map((r) => r.name)
    : [];
  if (fd.get("anyRole") === "on") roleNames.unshift("Any role");
  if (d.otherRoles) roleNames.push(d.otherRoles);

  const answers: Record<string, string | boolean> = {};
  for (const q of audition.questions) {
    if (q.type === "checkbox") answers[q.id] = fd.get(`q_${q.id}`) === "on";
    else {
      const v = val(fd, `q_${q.id}`).trim().slice(0, 4000);
      if (v) answers[q.id] = v;
    }
  }

  const slotRaw = val(fd, "slotId");
  const waitlist = slotRaw === "none";
  if (!waitlist && !isUuid(slotRaw)) return { error: "Pick an audition time.", fieldErrors: { slotId: "Pick a time" } };

  let token: string;
  try {
    const created = await insertSignupWithCapacity({
      auditionId: audition.id,
      slotId: waitlist ? null : slotRaw,
      firstName: d.firstName,
      lastName: d.lastName,
      // Minors often have no email of their own: fall back to the guardian's rather than asking twice.
      email: normalizeEmail((d.email ?? d.guardianEmail)!),
      phone: d.phone,
      age: d.age,
      guardianName: d.age < 18 ? d.guardianName : null,
      guardianEmail: d.age < 18 && d.guardianEmail ? normalizeEmail(d.guardianEmail) : null,
      guardianPhone: d.age < 18 ? d.guardianPhone : null,
      rolesInterested: roleNames.join(", ") || null,
      experience: d.experience,
      conflictsText: d.conflictsText,
      conflictDates: conflictDates.ok,
      answers,
    });
    token = created.manageToken;
  } catch (e) {
    if (e instanceof SlotFullError || (e instanceof Error && /Slot not found|already started/.test(e.message))) {
      return {
        error: "That time just filled up. Everything else you typed is still here — pick another time.",
        fieldErrors: { slotId: "That time just filled up — pick another" },
        slots: await publicSlotOptions(audition.id, org.timezone),
      };
    }
    throw e;
  }
  revalidatePath(`/audition/${slug}`);
  redirect(`/audition/${slug}/me/${token}?new=1`);
}

async function signupByToken(slug: string, token: string) {
  const row = await getPublicAudition(slug);
  if (!row || !token) return null;
  const signup = await db.query.auditionSignups.findFirst({
    where: and(eq(auditionSignups.manageToken, token), eq(auditionSignups.auditionId, row.audition.id)),
  });
  return signup ? { ...row, signup } : null;
}

export async function changeSlot(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const slug = val(fd, "slug");
  const ctx = await signupByToken(slug, val(fd, "token"));
  if (!ctx) return { error: "Signup not found." };
  if (ctx.signup.status !== "registered") return { error: "Your audition time can't be changed online any more. Please contact the production team." };
  if (!ctx.audition.isOpen) return { error: "Signups are closed, so times can't be changed online." };
  const slotId = val(fd, "slotId");
  if (!isUuid(slotId)) return { error: "Pick a new time." };
  if (slotId === ctx.signup.slotId) return { ok: "That's already your time." };
  const slot = await db.query.auditionSlots.findFirst({ where: (t, { eq: e }) => e(t.id, slotId) });
  if (!slot || slot.startsAt.getTime() < Date.now()) return { error: "That time isn't available." };
  try {
    await moveSignupSlot({ signupId: ctx.signup.id, auditionId: ctx.audition.id, slotId, kind: "audition", enforceCapacity: true });
  } catch (e) {
    if (e instanceof SlotFullError) return { error: e.message };
    return { error: "That time isn't available." };
  }
  revalidatePath(`/audition/${slug}`, "layout");
  return { ok: "Your audition time has been changed." };
}

export async function withdrawSignup(fd: FormData) {
  const slug = val(fd, "slug");
  const ctx = await signupByToken(slug, val(fd, "token"));
  if (!ctx) return;
  if (["registered", "checked_in", "auditioned", "callback"].includes(ctx.signup.status)) {
    await db.update(auditionSignups).set({ status: "withdrawn" }).where(eq(auditionSignups.id, ctx.signup.id));
  }
  revalidatePath(`/audition/${slug}`, "layout");
}

export async function updateConflicts(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const slug = val(fd, "slug");
  const ctx = await signupByToken(slug, val(fd, "token"));
  if (!ctx) return { error: "Signup not found." };
  if (!["registered", "checked_in", "auditioned", "callback"].includes(ctx.signup.status)) {
    return { error: "Casting is done, so conflicts can't be changed here. Please tell the stage manager." };
  }
  const parsed = parseConflictDates(val(fd, "conflictDates"));
  if ("error" in parsed) return { error: parsed.error, fieldErrors: { conflictDates: parsed.error } };
  await db
    .update(auditionSignups)
    .set({ conflictDates: parsed.ok, conflictsText: optional(4000).parse(val(fd, "conflictsText")) })
    .where(eq(auditionSignups.id, ctx.signup.id));
  revalidatePath(`/audition/${slug}`, "layout");
  return { ok: parsed.ok.length ? `Saved ${parsed.ok.length} conflict${parsed.ok.length === 1 ? "" : "s"}.` : "Saved. No conflicts listed." };
}
