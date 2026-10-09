"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { attendance, events } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { getEventCallSheet } from "@/lib/calls";

export type AttendanceResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();
const statusSchema = z.enum(["present", "late", "absent", "excused"]).nullable();

/** The editor's event + the set of people actually called to it (never trust ids from the client). */
async function authorize(productionId: string, eventId: string, personId: string) {
  const ctx = await requireProductionEditor(productionId);
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(personId).success) return null;
  const ev = await db.query.events.findFirst({ where: and(eq(events.id, eventId), eq(events.productionId, productionId)) });
  if (!ev) return null;
  const sheet = await getEventCallSheet(eventId);
  if (!sheet?.calls.has(personId)) return null;
  return ctx;
}

/** Present / late / absent / excused, or null to clear. */
export async function markAttendance(
  productionId: string,
  eventId: string,
  personId: string,
  status: "present" | "late" | "absent" | "excused" | null,
): Promise<AttendanceResult> {
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Invalid status" };
  const ctx = await authorize(productionId, eventId, personId);
  if (!ctx) return { ok: false, error: "That person isn't called to this event." };
  const where = and(eq(attendance.eventId, eventId), eq(attendance.personId, personId));
  if (parsed.data === null) {
    await db.delete(attendance).where(where);
  } else {
    const here = parsed.data === "present" || parsed.data === "late";
    const now = new Date();
    await db
      .insert(attendance)
      .values({ eventId, personId, status: parsed.data, checkedInAt: here ? now : null, markedByUserId: ctx.user.id })
      .onConflictDoUpdate({
        target: [attendance.eventId, attendance.personId],
        set: {
          status: parsed.data,
          markedByUserId: ctx.user.id,
          // keep the first check-in time when switching present ↔ late; clear it if marked away
          ...(here ? {} : { checkedInAt: null, checkedOutAt: null, pickedUpBy: null }),
        },
      });
    if (here) {
      // first check-in sets the time; re-taps keep it
      const [row] = await db.select().from(attendance).where(where);
      if (row && !row.checkedInAt) await db.update(attendance).set({ checkedInAt: now }).where(where);
    }
  }
  revalidatePath(`/p/${productionId}/schedule/${eventId}`, "layout");
  return { ok: true };
}

/** Sign someone out (who picked them up, for minors), or undo with pickedUpBy = undefined + undo. */
export async function signOut(
  productionId: string,
  eventId: string,
  personId: string,
  pickedUpBy: string | null,
  undo = false,
): Promise<AttendanceResult> {
  const text = z.string().trim().max(120).nullable().safeParse(pickedUpBy);
  if (!text.success) return { ok: false, error: "Keep the name under 120 characters." };
  const ctx = await authorize(productionId, eventId, personId);
  if (!ctx) return { ok: false, error: "That person isn't called to this event." };
  const where = and(eq(attendance.eventId, eventId), eq(attendance.personId, personId));
  const [row] = await db.select().from(attendance).where(where);
  if (!row || (row.status !== "present" && row.status !== "late")) return { ok: false, error: "Check them in first." };
  await db
    .update(attendance)
    .set(undo ? { checkedOutAt: null, pickedUpBy: null } : { checkedOutAt: new Date(), pickedUpBy: text.data || null, markedByUserId: ctx.user.id })
    .where(where);
  revalidatePath(`/p/${productionId}/schedule/${eventId}`, "layout");
  return { ok: true };
}
