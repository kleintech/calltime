import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sceneRoles } from "@/db/schema";
import { assertRolesInProduction, assertScenesInProduction, mutateCalls } from "@/lib/production-queries";

export const changesSchema = z
  .array(z.object({ sceneId: z.string(), roleId: z.string(), on: z.boolean() }))
  .min(1)
  .max(500);
export type BreakdownChange = z.infer<typeof changesSchema>[number];

/**
 * Apply breakdown cell changes in one transaction (shared by the server action and the unload
 * beacon route). Caller must have authorized the user as a production editor.
 */
export async function applyChanges(productionId: string, userId: string, changes: BreakdownChange[]) {
  const sceneIds = [...new Set(changes.map((c) => c.sceneId))];
  const roleIds = [...new Set(changes.map((c) => c.roleId))];
  await assertScenesInProduction(productionId, sceneIds);
  await assertRolesInProduction(productionId, roleIds);
  // Adding/removing a role from a scene changes who a published rehearsal of that scene calls.
  const { affected } = await mutateCalls(
    productionId,
    userId,
    async (tx) => {
      for (const c of changes) {
        if (c.on) await tx.insert(sceneRoles).values({ sceneId: c.sceneId, roleId: c.roleId }).onConflictDoNothing();
        else await tx.delete(sceneRoles).where(and(eq(sceneRoles.sceneId, c.sceneId), eq(sceneRoles.roleId, c.roleId)));
      }
    },
    { sceneIds, roleIds },
  );
  return affected;
}
