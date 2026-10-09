import "server-only";
import { and, gt, inArray, lt, sql } from "drizzle-orm";
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
  await sweepOld([k.email, k.ip]);
}

/**
 * Drop rows older than a day. Always for the given keys (uses the (key, created_at) index, so it's
 * one cheap delete); ~1 in 5 calls also sweep every key, since there's no index on created_at
 * alone and keys nobody hits again would otherwise linger.
 */
async function sweepOld(keys: string[]) {
  const cutoff = new Date(Date.now() - 86400_000);
  await db.delete(authFailures).where(and(inArray(authFailures.key, keys), lt(authFailures.createdAt, cutoff)));
  if (Math.random() < 0.2) await db.delete(authFailures).where(lt(authFailures.createdAt, cutoff));
}

/**
 * Generic limiter for public forms (audition signup): each key may be hit `max` times per window.
 * Null if allowed, else a friendly message. Records the hit when allowed.
 */
export async function takeRateLimit(limits: { key: string; max: number }[], message: string): Promise<string | null> {
  const since = new Date(Date.now() - WINDOW_MS);
  const keys = limits.map((l) => l.key);
  const rows = await db
    .select({ key: authFailures.key, n: sql<number>`count(*)::int` })
    .from(authFailures)
    .where(and(inArray(authFailures.key, keys), gt(authFailures.createdAt, since)))
    .groupBy(authFailures.key);
  for (const l of limits) {
    if ((rows.find((r) => r.key === l.key)?.n ?? 0) >= l.max) return message;
  }
  await db.insert(authFailures).values(keys.map((key) => ({ key })));
  return null;
}

/**
 * A successful sign-in clears that email's failures and this IP's: someone who finally types the
 * right password after a few typos shouldn't stay locked out for 15 minutes by the IP counter
 * (a shared school or venue network trips it quickly). The per-email lockout still has to clear
 * on its own for every other account, so a guesser can't reset those with one known password.
 */
export async function clearLoginFailures(email: string) {
  const k = keysFor(email, await clientIp());
  await db.delete(authFailures).where(inArray(authFailures.key, [k.email, k.ip]));
}
