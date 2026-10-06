"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { sceneRoles, scenes } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import {
  assertRolesInProduction,
  deleteCallsTargeting,
  formAction,
  getSceneInProduction,
  impactNote,
  mutateCalls,
  parseForm,
  renumber,
  type FormState,
} from "@/lib/production-queries";

const optText = (n: number) =>
  z
    .string()
    .trim()
    .max(n)
    .optional()
    .transform((v) => (v ? v : null));

const sceneSchema = z.object({
  act: z.coerce.number().int().min(0).max(20),
  number: z.string().trim().min(1, "Required").max(20),
  name: z.string().trim().min(1, "Required").max(200),
  description: optText(2000),
  songs: optText(1000),
  pages: optText(50),
  roleIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  hasRoles: z.string().optional(),
});

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`, "layout");
}

export async function createScene(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    const { roleIds, hasRoles, ...data } = parseForm(sceneSchema, fd);
    const ids = hasRoles ? await assertRolesInProduction(productionId, roleIds ?? []) : [];
    const [{ m }] = await db.select({ m: max(scenes.sortOrder) }).from(scenes).where(eq(scenes.productionId, productionId));
    const [row] = await db
      .insert(scenes)
      .values({ ...data, productionId, sortOrder: (m ?? 0) + 1 })
      .returning({ id: scenes.id });
    if (ids.length) await db.insert(sceneRoles).values(ids.map((roleId) => ({ sceneId: row.id, roleId })));
    revalidate(productionId);
    return { message: `Added ${data.name}.` };
  });
}

export async function updateScene(productionId: string, sceneId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { user } = await requireProductionEditor(productionId);
    await getSceneInProduction(productionId, sceneId);
    const { roleIds, hasRoles, ...data } = parseForm(sceneSchema, fd);
    // Label edits (name, songs…) aren't call changes, so they stay outside the impact wrapper.
    await db.update(scenes).set(data).where(eq(scenes.id, sceneId));
    let affected = 0;
    if (hasRoles) {
      const ids = await assertRolesInProduction(productionId, roleIds ?? []);
      ({ affected } = await mutateCalls(productionId, user.id, async (tx) => {
        await tx.delete(sceneRoles).where(eq(sceneRoles.sceneId, sceneId));
        if (ids.length) await tx.insert(sceneRoles).values(ids.map((roleId) => ({ sceneId, roleId })));
      }));
    }
    revalidate(productionId);
    return { message: `Saved.${impactNote(affected)}` };
  });
}

export async function deleteScene(productionId: string, sceneId: string) {
  const { user } = await requireProductionEditor(productionId);
  await getSceneInProduction(productionId, sceneId);
  await mutateCalls(productionId, user.id, async (tx) => {
    await tx.delete(scenes).where(and(eq(scenes.id, sceneId), eq(scenes.productionId, productionId)));
    await deleteCallsTargeting("scene", sceneId, tx);
  });
  revalidate(productionId);
  redirect(`/p/${productionId}/scenes`);
}

/** Swap a scene with its neighbor within the same act, then renumber sortOrder 1..n. */
export async function moveScene(productionId: string, sceneId: string, dir: "up" | "down") {
  await requireProductionEditor(productionId);
  await getSceneInProduction(productionId, sceneId);
  const rows = await db
    .select({ id: scenes.id, act: scenes.act })
    .from(scenes)
    .where(eq(scenes.productionId, productionId))
    .orderBy(asc(scenes.act), asc(scenes.sortOrder), asc(scenes.createdAt));
  const i = rows.findIndex((r) => r.id === sceneId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length || rows[j].act !== rows[i].act) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await renumber(scenes, rows.map((r) => r.id));
  revalidate(productionId);
}
