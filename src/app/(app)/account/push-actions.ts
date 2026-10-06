"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { pushConfigured, sendPushToUsers } from "@/lib/push";

/**
 * Only real browser push services — never let a user make our server POST to arbitrary URLs.
 * jmt17.google.com is the push host used by open-source Chromium builds.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^jmt17\.google\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

function isAllowedPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const subSchema = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Store (or move to this account) the browser's push subscription. */
export async function savePushSubscription(sub: unknown, userAgent?: string) {
  const user = await requireUser();
  const parsed = subSchema.safeParse(sub);
  if (!parsed.success || !(await isAllowedPushEndpoint(parsed.data.endpoint))) return { error: "Unsupported push service." };
  const { endpoint, keys } = parsed.data;
  const ua = (userAgent ?? "").slice(0, 300) || null;
  await db.transaction(async (tx) => {
    // An endpoint registered to someone else (shared device, new sign-in) is dropped and recreated
    // for this user — never re-pointed, so nobody can claim another account's row by endpoint.
    await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), ne(pushSubscriptions.userId, user.id)));
    await tx
      .insert(pushSubscriptions)
      .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
        setWhere: eq(pushSubscriptions.userId, user.id),
      });
  });
  return { ok: true };
}

export async function deletePushSubscription(endpoint: string) {
  const user = await requireUser();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, z.string().max(2000).parse(endpoint)), eq(pushSubscriptions.userId, user.id)));
  return { ok: true };
}

export async function sendTestPush() {
  const user = await requireUser();
  if (!pushConfigured()) return { error: "Notifications aren't set up on this server yet." };
  const r = await sendPushToUsers([user.id], {
    title: "Calltime test",
    body: `Hi ${user.name.split(" ")[0]} — this is how call changes will reach you.`,
    url: "/account",
    tag: "test",
  });
  if (r.sent === 0) return { error: r.removed ? "This device's subscription expired. Turn notifications off and on again." : "No devices are subscribed yet." };
  return { ok: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` };
}
