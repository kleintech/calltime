"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { creativeTeam, invites, users } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { createInvite } from "@/lib/invites";
import { ActionError, ensureOrgMember, formAction, isUuid, parseForm, type FormState } from "@/lib/production-queries";

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
    const existing = await db.query.users.findFirst({ where: eq(users.email, t.email) });
    if (existing) {
      await ensureOrgMember(org.id, existing.id);
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
      message: `No account for ${t.email} yet. Send them this link; they'll join as ${title} when they sign up.`,
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
