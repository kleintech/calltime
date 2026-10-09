"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { eventChanges, events } from "@/db/schema";
import { getCoveredPersonIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { getEventCallSheet } from "@/lib/calls";
import { acknowledge, getUnacknowledgedChanges } from "@/lib/changes";

/**
 * "Got it": the signed-in family has seen this event's changes up to `revision` (the one their
 * screen showed — a newer change saved meanwhile stays unacknowledged).
 */
export async function acknowledgeEvent(eventId: string, revision: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(eventId).success || !z.number().int().min(0).safeParse(revision).success) return { ok: false, error: "Not found" };

  const pending = (await getUnacknowledgedChanges(user.id)).find((c) => c.event.id === eventId);
  if (pending) {
    await acknowledge(user.id, eventId, Math.min(revision, pending.latestRevision));
  } else {
    // A cancellation from before change tracking (no change rows): allowed if it calls their people.
    const ev = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!ev || ev.status !== "cancelled") return { ok: false, error: "Not found" };
    const hasChanges = await db.select({ id: eventChanges.id }).from(eventChanges).where(eq(eventChanges.eventId, eventId)).limit(1);
    const [covered, sheet] = await Promise.all([getCoveredPersonIds(user.id), getEventCallSheet(eventId)]);
    if (hasChanges.length || !sheet || !covered.some((id) => sheet.calls.has(id))) return { ok: false, error: "Not found" };
    await acknowledge(user.id, eventId, Math.min(revision, ev.revision));
  }
  revalidatePath("/home", "layout");
  return { ok: true };
}

