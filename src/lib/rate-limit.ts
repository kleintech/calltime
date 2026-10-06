import "server-only";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { authFailures } from "@/db/schema";

/*
 * Password-guessing limiter, DB-backed so it holds across serverless instances.
 * 10 failures per email or 50 per IP within 15 minutes → locked until the window slides.
 */
const WINDOW_MS = 15 * 60_000;
export const MAX_PER_EMAIL = 10;
export const MAX_PER_IP = 50;

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

const keysFor = (email: string, ip: string) => ({ email: `email:${email.toLowerCase()}`, ip: `ip:${ip}` });

/** Null if allowed, else a friendly message. Call before checking the password. */
export async function checkLoginRateLimit(email: string): Promise<string | null> {
  const k = keysFor(email, await clientIp());
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db
    .select({ key: authFailures.key, n: sql<number>`count(*)::int` })
    .from(authFailures)
    .where(and(inArray(authFailures.key, [k.email, k.ip]), gt(authFailures.createdAt, since)))
    .groupBy(authFailures.key);
  const n = (key: string) => rows.find((r) => r.key === key)?.n ?? 0;
  if (n(k.email) >= MAX_PER_EMAIL || n(k.ip) >= MAX_PER_IP) {
    return "Too many sign-in attempts. Wait 15 minutes and try again.";
  }
  return null;
}

export async function recordLoginFailure(email: string) {
  const k = keysFor(email, await clientIp());
  await db.insert(authFailures).values([{ key: k.email }, { key: k.ip }]);
  // Opportunistic cleanup (~1 in 20 failures).
  if (Math.random() < 0.05) await db.delete(authFailures).where(lt(authFailures.createdAt, new Date(Date.now() - 86400_000)));
}

/** A successful sign-in clears that email's failures (not the IP's). */
export async function clearLoginFailures(email: string) {
  await db.delete(authFailures).where(eq(authFailures.key, keysFor(email, "").email));
}
