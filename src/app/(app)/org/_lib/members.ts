import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers, users } from "@/db/schema";
import { createInvite } from "@/lib/invites";
import type { FormState } from "../_components/form-state";
import { messageForInvite } from "./org";

/**
 * Not an action: callers must have authorized the org already.
 * Shared by the Company area and platform admin. Someone already in this org can be promoted
 * directly; anyone else — even if they have a Calltime account elsewhere — gets an invite link and
 * must accept it themselves. We never reveal whether an email has an account on the platform.
 */
export async function grantOrgRoleByEmail(args: {
  orgId: string;
  email: string;
  name?: string;
  role: "admin" | "member";
  invitedByUserId: string;
}): Promise<FormState> {
  const member = await db
    .select({ user: users, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.orgId, args.orgId), eq(users.email, args.email)))
    .limit(1);
  if (member[0]) {
    const { user, role } = member[0];
    if (args.role === "admin" && role !== "admin") {
      await db.update(orgMembers).set({ role: "admin" }).where(and(eq(orgMembers.orgId, args.orgId), eq(orgMembers.userId, user.id)));
      return { ok: `${user.name} is now an admin.` };
    }
    return { error: `${user.name} (${user.email}) is already ${role === "admin" ? "an admin" : "a member"} here.` };
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
