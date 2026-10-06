"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { pushConfigured, sendPushToUsers } from "@/lib/push";

const subSchema = z.object({
  endpoint: z.url().max(2000).refine((u) => u.startsWith("https://"), "Push endpoints must be https."),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Store (or move to this account) the browser's push subscription. */
export async function savePushSubscription(sub: unknown, userAgent?: string) {
  const user = await requireUser();
  const parsed = subSchema.parse(sub);
  const ua = (userAgent ?? "").slice(0, 300) || null;
  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint: parsed.endpoint, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth, userAgent: ua })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth, userAgent: ua },
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
