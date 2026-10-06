"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { sceneRoles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { ActionError, getRoleInProduction, getSceneInProduction } from "@/lib/production-queries";

/** Toggle one cell of the scene breakdown. Returns an error message instead of throwing so the UI can roll back. */
export async function toggleSceneRole(
  productionId: string,
  sceneId: string,
  roleId: string,
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireProductionEditor(productionId);
    z.boolean().parse(on);
    await getSceneInProduction(productionId, sceneId);
    await getRoleInProduction(productionId, roleId);
    if (on) await db.insert(sceneRoles).values({ sceneId, roleId }).onConflictDoNothing();
    else await db.delete(sceneRoles).where(and(eq(sceneRoles.sceneId, sceneId), eq(sceneRoles.roleId, roleId)));
    revalidatePath(`/p/${productionId}`, "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }
}
