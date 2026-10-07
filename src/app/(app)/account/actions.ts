"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { guardianships, people, users } from "@/db/schema";
import { hashPassword, normalizeEmail, requireUser, revokeOtherSessions, verifyPassword } from "@/lib/auth";
import { demoRestriction } from "@/lib/demo";
import { createInvite, guardianInviteGrant } from "@/lib/invites";
import { firstIssue, type FormState } from "../org/_components/form-state";
import { messageForInvite } from "../org/_lib/org";

export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Enter your name.").max(120),
      phone: z
        .string()
        .trim()
        .max(40)
        .transform((v) => v || null),
    })
    .safeParse({ name: fd.get("name") ?? "", phone: fd.get("phone") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: "Profile saved." };
}

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  // Demo accounts are shared by every visitor; a new password would lock everyone else out.
  const restricted = demoRestriction(user.email, "change the demo account's password");
  if (restricted) return { error: restricted };
  const parsed = z
    .object({
      current: z.string(),
      next: z.string().min(8, "Use at least 8 characters.").max(200),
      confirm: z.string(),
    })
    .refine((v) => v.next === v.confirm, "The new passwords don't match.")
    .safeParse({ current: fd.get("current") ?? "", next: fd.get("next") ?? "", confirm: fd.get("confirm") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (user.passwordHash && !(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return { error: "Your current password isn't right." };
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.next) }).where(eq(users.id, user.id));
  await revokeOtherSessions(user.id);
  return { ok: "Password changed. You've been signed out on other devices." };
}

/** A guardian invites another parent/guardian for one of their own kids (no admin needed). */
export async function inviteCoGuardian(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      minorId: z.uuid(),
      name: z.string().trim().max(120),
      email: z.email("Enter their email address."),
    })
    .safeParse({ minorId: fd.get("minorId"), name: fd.get("name") ?? "", email: normalizeEmail(String(fd.get("email") ?? "")) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  // Must be this user's ward: guardianship from one of the user's own person records.
  const ownIds = (await db.select({ id: people.id }).from(people).where(eq(people.userId, user.id))).map((p) => p.id);
  if (ownIds.length === 0) return { error: "You can only invite guardians for your own kids." };
  const [link] = await db
    .select({ minor: people })
    .from(guardianships)
    .innerJoin(people, eq(people.id, guardianships.minorId))
    .where(and(eq(guardianships.minorId, parsed.data.minorId), inArray(guardianships.guardianId, ownIds)))
    .limit(1);
  if (!link) return { error: "You can only invite guardians for your own kids." };
  if (parsed.data.email === user.email) return { error: "That's your own email — use theirs." };
  const restricted = demoRestriction(user.email, "send invites");
  if (restricted) return { error: restricted };
  // If the other parent is already on file unlinked under this email, claim that record instead of
  // creating a second one (guardianInviteGrant); a parent isn't staff, so this only applies when the
  // claim check allows it and otherwise falls back to the plain guardian invite.
  const base = { orgId: link.minor.orgId, email: parsed.data.email, guardianOfPersonId: link.minor.id, invitedByUserId: user.id };
  const { invite, url } = await createInvite({
    ...base,
    ...(await guardianInviteGrant(base)),
    name: parsed.data.name || null,
  });
  return { ok: `Invite for ${parsed.data.name || parsed.data.email}`, link: url, message: await messageForInvite(invite, url) };
}
