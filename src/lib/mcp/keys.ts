import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, orgMembers, organizations, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/auth";

/**
 * API keys for the MCP endpoint. Format: "ct_" + 32 url-safe random chars. Only the sha256 is
 * stored; the full key is shown once at creation. `prefix` (first 7 chars) identifies it in the UI.
 */
export function generateApiKey() {
  const key = `ct_${randomToken(24)}`;
  return { key, prefix: key.slice(0, 7), hash: sha256(key) };
}

export async function createApiKey(opts: { orgId: string; userId: string; name: string }) {
  const { key, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ orgId: opts.orgId, userId: opts.userId, name: opts.name.trim() || "API key", prefix, hash })
    .returning();
  return { key, row };
}

export type McpAuth = {
  keyId: string;
  orgId: string;
  orgName: string;
  timezone: string;
  userId: string;
  userName: string;
};

/**
 * Resolve a bearer token to its org + acting user. Returns null for unknown, revoked, or
 * malformed keys, and for keys whose user is no longer an admin of the org (platform admins
 * excepted) — demoting someone disables the keys they made.
 */
export async function verifyApiKey(token: string | undefined | null): Promise<McpAuth | null> {
  if (!token || !token.startsWith("ct_") || token.length > 200) return null;
  const rows = await db
    .select({ key: apiKeys, org: organizations, user: users })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.orgId))
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.hash, sha256(token)), isNull(apiKeys.revokedAt)))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  if (!hit.user.isPlatformAdmin) {
    const m = await db.query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, hit.org.id), eq(orgMembers.userId, hit.user.id)),
    });
    if (m?.role !== "admin") return null;
  }
  // Throttle writes: only touch lastUsedAt if it's more than a minute stale.
  const last = hit.key.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - last > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, hit.key.id));
  }
  return {
    keyId: hit.key.id,
    orgId: hit.org.id,
    orgName: hit.org.name,
    timezone: hit.org.timezone,
    userId: hit.user.id,
    userName: hit.user.name,
  };
}
