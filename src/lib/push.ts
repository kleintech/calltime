import "server-only";
import { eq, inArray, isNotNull, and } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { guardianships, people, pushSubscriptions } from "@/db/schema";

/*
 * Web Push. Families only get pinged about *their* people's calls: resolve people → accounts with
 * usersCoveringPeople(), then sendPushToUsers(). Everything is a no-op without VAPID env vars.
 *
 *   const userIds = await usersCoveringPeople(affectedPersonIds);
 *   await sendPushToUsers(userIds, { title: "Tue rehearsal changed", body: "Maya now 6:30–8:00 PM", url: "/home", tag: `event-${id}` });
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Opened on tap. Relative to the app origin, e.g. "/home" or "/p/<id>/schedule/<eventId>". */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking (e.g. `event-<id>`). */
  tag?: string;
};

let configured: boolean | null = null;
/** True when VAPID keys are present (and configures web-push once). */
export function pushConfigured() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@calltime.app";
  configured = !!(pub && priv);
  if (configured) webpush.setVapidDetails(subject, pub!, priv!);
  return configured;
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

/** Accounts that should hear about these people: their own account plus their guardians' accounts. */
export async function usersCoveringPeople(personIds: string[]): Promise<string[]> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return [];
  const [own, guardians] = await Promise.all([
    db
      .select({ userId: people.userId })
      .from(people)
      .where(and(inArray(people.id, ids), isNotNull(people.userId))),
    db
      .select({ userId: people.userId })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.guardianId))
      .where(and(inArray(guardianships.minorId, ids), isNotNull(people.userId))),
  ]);
  return [...new Set([...own, ...guardians].map((r) => r.userId!).filter(Boolean))];
}

/**
 * Send one notification to every device of these users. Expired subscriptions (404/410) are
 * deleted. Never throws; returns counts. Safe to call fire-and-forget (`void sendPushToUsers(...)`)
 * but awaiting it is better inside Server Actions so the work isn't cut off.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  const result = { sent: 0, failed: 0, removed: 0 };
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || !pushConfigured()) return result;
  try {
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
    const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? "/home", tag: payload.tag });
    const ok: string[] = [];
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 60 * 60 * 24,
            urgency: "high",
            topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
          });
          ok.push(s.id);
        } catch (e) {
          const err = e as { statusCode?: number; body?: string; message?: string; code?: string };
          const host = (() => {
            try {
              return new URL(s.endpoint).host;
            } catch {
              return "?";
            }
          })();
          if (err.statusCode === 404 || err.statusCode === 410) {
            gone.push(s.id);
            console.info(`[push] ${host} says subscription is gone (${err.statusCode}); removing`, err.body?.slice(0, 200) ?? "");
          } else {
            result.failed++;
            console.warn(`[push] send to ${host} failed`, err.statusCode ?? err.code ?? "", err.message, err.body?.slice(0, 200) ?? "");
          }
        }
      }),
    );
    result.sent = ok.length;
    result.removed = gone.length;
    if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    if (ok.length) await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(inArray(pushSubscriptions.id, ok));
  } catch (e) {
    console.error("[push] sendPushToUsers failed", e);
  }
  return result;
}
