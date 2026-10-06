"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { invites, orgMembers } from "@/db/schema";
import { requireOrgAdmin } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";
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
