"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { creativeTeam, invites, orgMembers, users } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { createInvite } from "@/lib/invites";
import { ActionError, formAction, isUuid, parseForm, type FormState } from "@/lib/production-queries";

const titleSchema = z.object({
  title: z.string().trim().max(60),
  customTitle: z.string().trim().max(60).optional(),
  canEdit: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "1"),
});

function resolveTitle(t: { title: string; customTitle?: string }) {
  const title = t.title === "__custom" ? (t.customTitle ?? "") : t.title;
  if (!title) throw new ActionError("Enter a title, e.g. “Lighting Designer”.");
  return title;
}

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`, "layout");
}

export async function addTeamMember(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { org, user, production } = await requireProductionEditor(productionId);
    const t = parseForm(
      titleSchema.extend({
        email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
        name: z.string().trim().max(120).optional(),
      }),
      fd,
    );
    const title = resolveTitle(t);
    // Only people already in this company are added directly. Anyone else — even with a Calltime
    // account in another company — gets an invite link, and we don't reveal whether they have one.
    const [member] = await db
      .select({ user: users })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, org.id), eq(users.email, t.email)))
      .limit(1);
    const existing = member?.user;
    if (existing) {
      await db
        .insert(creativeTeam)
        .values({ productionId, userId: existing.id, title, canEdit: t.canEdit })
        .onConflictDoUpdate({ target: [creativeTeam.productionId, creativeTeam.userId], set: { title, canEdit: t.canEdit } });
      revalidate(productionId);
      return { message: `${existing.name} added as ${title}.` };
    }
    const { url } = await createInvite({
      orgId: org.id,
      email: t.email,
      name: t.name || null,
      productionId,
      creativeTitle: title,
      invitedByUserId: user.id,
    });
    revalidate(productionId);
    return {
      inviteUrl: url,
      shareText: `${t.name ? `Hi ${t.name.split(" ")[0]}! ` : ""}${user.name} invited you to join ${production.title} as ${title} on Calltime:`,
      message: `Send ${t.email} this link; they'll join as ${title} when they accept it.`,
    };
  });
}

export async function updateTeamMember(productionId: string, userId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { user } = await requireProductionEditor(productionId);
    if (!isUuid(userId)) throw new ActionError("Unknown member");
    const t = parseForm(titleSchema, fd);
    const title = resolveTitle(t);
    if (userId === user.id && !t.canEdit) throw new ActionError("You can't remove your own edit access.");
    const res = await db
      .update(creativeTeam)
      .set({ title, canEdit: t.canEdit })
      .where(and(eq(creativeTeam.productionId, productionId), eq(creativeTeam.userId, userId)))
      .returning({ userId: creativeTeam.userId });
    if (!res.length) throw new ActionError("Unknown member");
    revalidate(productionId);
    return { message: "Saved." };
  });
}

export async function removeTeamMember(productionId: string, userId: string) {
  await requireProductionEditor(productionId);
  if (!isUuid(userId)) return;
  await db.delete(creativeTeam).where(and(eq(creativeTeam.productionId, productionId), eq(creativeTeam.userId, userId)));
  revalidate(productionId);
}

export async function revokeTeamInvite(productionId: string, inviteId: string) {
  await requireProductionEditor(productionId);
  if (!isUuid(inviteId)) return;
  await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.productionId, productionId), isNull(invites.acceptedAt)));
  revalidate(productionId);
}
