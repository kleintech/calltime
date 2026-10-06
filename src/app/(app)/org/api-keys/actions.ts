"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { requireOrgAdmin } from "@/lib/access";
import { createApiKey } from "@/lib/mcp/keys";

export type CreateKeyState = { error?: string; key?: string; name?: string };

const createSchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(1, "Give the key a name, e.g. “Claude — Jordan’s laptop”.").max(80),
});

export async function createKeyAction(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  const parsed = createSchema.safeParse({ orgId: formData.get("orgId"), name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { user, org } = await requireOrgAdmin(parsed.data.orgId);
  const { key } = await createApiKey({ orgId: org.id, userId: user.id, name: parsed.data.name });
  revalidatePath("/org/api-keys");
  return { key, name: parsed.data.name };
}

const revokeSchema = z.object({ orgId: z.uuid(), keyId: z.uuid() });

export async function revokeKeyAction(formData: FormData) {
  const parsed = revokeSchema.safeParse({ orgId: formData.get("orgId"), keyId: formData.get("keyId") });
  if (!parsed.success) return;
  const { org } = await requireOrgAdmin(parsed.data.orgId);
  // Scoped to the authorized org, so a forged keyId from another org is a no-op.
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, parsed.data.keyId), eq(apiKeys.orgId, org.id), isNull(apiKeys.revokedAt)));
  revalidatePath("/org/api-keys");
}
