"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sceneRoles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { ActionError, assertRolesInProduction, assertScenesInProduction, mutateCalls } from "@/lib/production-queries";

const changesSchema = z
  .array(z.object({ sceneId: z.string(), roleId: z.string(), on: z.boolean() }))
  .min(1)
  .max(500);

/**
 * Apply a batch of breakdown cell toggles (the grid debounces rapid taps into one call). One
 * transaction, so families get one change per affected rehearsal, not one per tap. Returns an
 * error message instead of throwing so the UI can roll back.
 */
export async function applyBreakdownChanges(
  productionId: string,
  input: { sceneId: string; roleId: string; on: boolean }[],
): Promise<{ ok: true; affected: number } | { ok: false; error: string }> {
  try {
    const { user } = await requireProductionEditor(productionId);
    const parsed = changesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid change." };
    const changes = parsed.data;
    await assertScenesInProduction(productionId, changes.map((c) => c.sceneId));
    await assertRolesInProduction(productionId, changes.map((c) => c.roleId));
    // Adding/removing a role from a scene changes who a published rehearsal of that scene calls.
    const { affected } = await mutateCalls(productionId, user.id, async (tx) => {
      for (const c of changes) {
        if (c.on) await tx.insert(sceneRoles).values({ sceneId: c.sceneId, roleId: c.roleId }).onConflictDoNothing();
        else await tx.delete(sceneRoles).where(and(eq(sceneRoles.sceneId, c.sceneId), eq(sceneRoles.roleId, c.roleId)));
      }
    });
    revalidatePath(`/p/${productionId}`, "layout");
    return { ok: true, affected };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }
}
