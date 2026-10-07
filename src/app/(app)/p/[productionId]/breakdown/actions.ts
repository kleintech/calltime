"use server";

import { revalidatePath } from "next/cache";
import { requireProductionEditor } from "@/lib/access";
import { ActionError } from "@/lib/production-queries";
import { applyChanges, changesSchema, type BreakdownChange } from "./apply";

/**
 * Apply a batch of breakdown cell toggles (the grid debounces rapid taps into one call). One
 * transaction, so families get one change per affected rehearsal, not one per tap. Returns an
 * error message instead of throwing so the UI can roll back.
 */
export async function applyBreakdownChanges(
  productionId: string,
  input: BreakdownChange[],
): Promise<{ ok: true; affected: number } | { ok: false; error: string }> {
  try {
    const { user } = await requireProductionEditor(productionId);
    const parsed = changesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid change." };
    const affected = await applyChanges(productionId, user.id, parsed.data);
    revalidatePath(`/p/${productionId}`, "layout");
    return { ok: true, affected };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }
}
