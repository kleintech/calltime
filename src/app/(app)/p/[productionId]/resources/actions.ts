"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { resources } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import {
  ActionError,
  formAction,
  getRoleInProduction,
  getSceneInProduction,
  guessResourceKind,
  isUuid,
  parseForm,
  RESOURCE_KINDS,
  type FormState,
} from "@/lib/production-queries";

const optId = z
  .string()
  .optional()
  .transform((v) => (v ? v : null));

const resourceSchema = z.object({
  title: z.string().trim().min(1, "Give it a name, e.g. “Act 1 vocal tracks”").max(200),
  url: z
    .string()
    .trim()
    .min(1, "Paste a link")
    .max(2000)
    .transform((v) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`))
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter a web link starting with https://"),
  kind: z.enum(["auto", ...RESOURCE_KINDS]).default("auto"),
  sceneId: optId,
  roleId: optId,
});

export async function addResource(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    const data = parseForm(resourceSchema, fd);
    if (data.sceneId) await getSceneInProduction(productionId, data.sceneId);
    if (data.roleId) await getRoleInProduction(productionId, data.roleId);
    const [{ m }] = await db
      .select({ m: max(resources.sortOrder) })
      .from(resources)
      .where(eq(resources.productionId, productionId));
    await db.insert(resources).values({
      productionId,
      title: data.title,
      url: data.url,
      kind: data.kind === "auto" ? guessResourceKind(data.url) : data.kind,
      sceneId: data.sceneId,
      roleId: data.roleId,
      sortOrder: (m ?? 0) + 1,
    });
    revalidatePath(`/p/${productionId}`, "layout");
    return { message: `Added “${data.title}”.` };
  });
}

export async function deleteResource(productionId: string, resourceId: string) {
  await requireProductionEditor(productionId);
  if (!isUuid(resourceId)) throw new ActionError("Unknown link");
  await db.delete(resources).where(and(eq(resources.id, resourceId), eq(resources.productionId, productionId)));
  revalidatePath(`/p/${productionId}`, "layout");
}
