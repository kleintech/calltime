"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { productions } from "@/db/schema";
import { requireOrgAdmin, requireProductionEditor } from "@/lib/access";
import { ActionError, formAction, parseForm, type FormState } from "@/lib/production-queries";
import { productionSchema } from "@/app/(app)/productions/_components/production-schema";

export async function updateProduction(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    const data = parseForm(productionSchema, fd);
    await db.update(productions).set(data).where(eq(productions.id, productionId));
    revalidatePath(`/p/${productionId}`, "layout");
    revalidatePath("/productions");
    return { message: "Saved." };
  });
}

export async function deleteProduction(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const res = await formAction(async () => {
    const { production } = await requireProductionEditor(productionId);
    await requireOrgAdmin(production.orgId);
    const { confirm } = parseForm(z.object({ confirm: z.string() }), fd);
    if (confirm.trim() !== production.title.trim()) throw new ActionError("Type the production title exactly to confirm.");
    await db.delete(productions).where(eq(productions.id, productionId));
  });
  if (res.ok) {
    revalidatePath("/productions");
    redirect("/productions");
  }
  return res;
}
