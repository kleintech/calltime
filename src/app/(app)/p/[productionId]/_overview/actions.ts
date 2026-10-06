"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { formAction, isUuid, parseForm, type FormState } from "@/lib/production-queries";

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`);
  revalidatePath("/home");
}

export async function postAnnouncement(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { user } = await requireProductionEditor(productionId);
    const data = parseForm(
      z.object({
        title: z.string().trim().min(1, "Required").max(200),
        body: z.string().trim().min(1, "Required").max(5000),
        pinned: z
          .string()
          .optional()
          .transform((v) => v === "on"),
      }),
      fd,
    );
    await db.insert(announcements).values({ ...data, productionId, authorUserId: user.id });
    revalidate(productionId);
    return { message: "Posted." };
  });
}

export async function setAnnouncementPinned(productionId: string, id: string, pinned: boolean) {
  await requireProductionEditor(productionId);
  if (!isUuid(id)) return;
  await db
    .update(announcements)
    .set({ pinned })
    .where(and(eq(announcements.id, id), eq(announcements.productionId, productionId)));
  revalidate(productionId);
}

export async function deleteAnnouncement(productionId: string, id: string) {
  await requireProductionEditor(productionId);
  if (!isUuid(id)) return;
  await db.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.productionId, productionId)));
  revalidate(productionId);
}
