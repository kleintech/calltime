"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { invites, orgMembers, users } from "@/db/schema";
import { requireOrgAdmin } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";
import { demoRestriction } from "@/lib/demo";
import { emailConfigured } from "@/lib/email";
import { issuePasswordReset, sendPasswordResetEmail } from "@/lib/password-reset";
import { firstIssue, type FormState } from "../_components/form-state";
import { grantOrgRoleByEmail } from "../_lib/members";

function revalidateOrg(orgId: string) {
  revalidatePath("/org", "layout");
  revalidatePath(`/admin/${orgId}`);
  revalidatePath("/admin");
}

const inviteSchema = z.object({
  orgId: z.uuid(),
  email: z.email("Enter a valid email address."),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "member"]),
});

/**
 * Invite someone to the org. An existing account is added straight away; otherwise an invite link
 * is created and returned for the admin to share.
 */
export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = inviteSchema.safeParse({
    orgId: fd.get("orgId"),
    email: normalizeEmail(String(fd.get("email") ?? "")),
    name: fd.get("name") || undefined,
    role: fd.get("role"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { orgId, email, name, role } = parsed.data;
  const { user: me } = await requireOrgAdmin(orgId);
  const result = await grantOrgRoleByEmail({ orgId, email, name, role, invitedByUserId: me.id });
  revalidateOrg(orgId);
  return result;
}


const memberSchema = z.object({ orgId: z.uuid(), userId: z.uuid() });

async function adminCount(orgId: string, q: Pick<typeof db, "select"> = db) {
  const [row] = await q
    .select({ n: count() })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")));
  return row?.n ?? 0;
}

export async function setMemberRole(fd: FormData) {
  const { orgId, userId } = memberSchema.parse({ orgId: fd.get("orgId"), userId: fd.get("userId") });
  const role = z.enum(["admin", "member"]).parse(fd.get("role"));
  await requireOrgAdmin(orgId);
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)),
  });
  if (!membership) return;
  // Never leave an org without an admin — counted under a lock so two concurrent demotions can't both pass.
  await db.transaction(async (tx) => {
    await tx.select().from(orgMembers).where(eq(orgMembers.orgId, orgId)).for("update");
    if (membership.role === "admin" && role === "member" && (await adminCount(orgId, tx)) <= 1) return;
    await tx.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  });
  revalidateOrg(orgId);
}

export async function removeMember(fd: FormData) {
  const { orgId, userId } = memberSchema.parse({ orgId: fd.get("orgId"), userId: fd.get("userId") });
  await requireOrgAdmin(orgId);
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)),
  });
  if (!membership) return;
  await db.transaction(async (tx) => {
    await tx.select().from(orgMembers).where(eq(orgMembers.orgId, orgId)).for("update");
    if (membership.role === "admin" && (await adminCount(orgId, tx)) <= 1) return;
    await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  });
  revalidateOrg(orgId);
}

export async function revokeInvite(fd: FormData) {
  const { orgId, inviteId } = z.object({ orgId: z.uuid(), inviteId: z.uuid() }).parse({
    orgId: fd.get("orgId"),
    inviteId: fd.get("inviteId"),
  });
  await requireOrgAdmin(orgId);
  await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)));
  revalidateOrg(orgId);
}

/**
 * A one-time password reset link for a member, for admins to send by text or in person when the
 * member can't get email (or this Calltime has no mailer). Emailed too when the mailer is set up.
 */
export async function issuePasswordResetLink(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = memberSchema.safeParse({ orgId: fd.get("orgId"), userId: fd.get("userId") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { orgId, userId } = parsed.data;
  const { user: me, org } = await requireOrgAdmin(orgId);
  const demo = demoRestriction(me.email, "send reset links");
  if (demo) return { error: demo };
  const [target] = await db
    .select({ user: users })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!target) return { error: "That person isn't a member here any more." };
  const { url } = await issuePasswordReset(userId, { issuedByUserId: me.id });
  let emailed = false;
  if (emailConfigured()) {
    const sent = await sendPasswordResetEmail(target.user, url, { requestedBy: `${me.name} at ${org.name}` });
    emailed = sent.ok;
    if (!sent.ok) console.error("[password-reset] email failed:", sent.reason);
  }
  const first = target.user.name.trim().split(/\s+/)[0] || target.user.name;
  return {
    ok: `Reset link for ${target.user.name} — expires in 1 hour.${emailed ? ` We also emailed it to ${target.user.email}.` : ""}`,
    link: url,
    message: `Hi ${first}, here's a link to set a new Calltime password: ${url} (it expires in an hour).`,
  };
}
