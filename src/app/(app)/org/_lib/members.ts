import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers, users } from "@/db/schema";
import { createInvite } from "@/lib/invites";
import type { FormState } from "../_components/form-state";
import { messageForInvite } from "./org";

/** Not an action: callers must have authorized the org already. */
/** Shared by the Company area and platform admin: add an existing user, else make an invite link. */
export async function grantOrgRoleByEmail(args: {
  orgId: string;
  email: string;
  name?: string;
  role: "admin" | "member";
  invitedByUserId: string;
}): Promise<FormState> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, args.email) });
  if (existing) {
    const membership = await db.query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, existing.id)),
    });
    if (!membership) {
      await db.insert(orgMembers).values({ orgId: args.orgId, userId: existing.id, role: args.role });
      return { ok: `${existing.name} already had an account and was added as ${args.role === "admin" ? "an admin" : "a member"}.` };
    }
    if (args.role === "admin" && membership.role !== "admin") {
      await db
        .update(orgMembers)
        .set({ role: "admin" })
        .where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, existing.id)));
      return { ok: `${existing.name} is now an admin.` };
    }
    return { error: `${existing.name} (${existing.email}) is already a ${membership.role}.` };
  }
  const { invite, url } = await createInvite({
    orgId: args.orgId,
    email: args.email,
    name: args.name || null,
    orgRole: args.role,
    invitedByUserId: args.invitedByUserId,
  });
  return { ok: `Invite link for ${args.name || args.email}`, link: url, message: await messageForInvite(invite, url) };
}

