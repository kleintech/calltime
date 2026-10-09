"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { randomToken, requireUser } from "@/lib/auth";

/** Home shows "Add to my calendar" vs "Calendar sync on"; Me shows the connected date. */
function revalidateCalendarState() {
  revalidatePath("/home", "layout");
  revalidatePath("/home/calendar");
  revalidatePath("/account");
}

/**
 * "Yes, it's there": the user confirmed the calendar shows up in their app. Only fills the date
 * when it's empty so a feed fetch that already recorded it keeps the earlier time.
 */
export async function markCalendarConnected() {
  const user = await requireUser();
  await db
    .update(users)
    .set({ calendarConnectedAt: new Date() })
    .where(and(eq(users.id, user.id), isNull(users.calendarConnectedAt)));
  revalidateCalendarState();
  redirect("/home/calendar?connected=1");
}

/** "Not seeing it?": forget the connection so the setup steps come back. */
export async function markCalendarNotConnected() {
  const user = await requireUser();
  await db.update(users).set({ calendarConnectedAt: null }).where(eq(users.id, user.id));
  revalidateCalendarState();
  redirect("/home/calendar");
}

/**
 * Rotate the signed-in user's calendar token. Every existing subscription stops updating, so the
 * calendar is no longer connected until they subscribe again.
 */
export async function resetCalendarLink() {
  const user = await requireUser();
  await db
    .update(users)
    .set({ calendarToken: randomToken(24), calendarConnectedAt: null })
    .where(eq(users.id, user.id));
  revalidateCalendarState();
  redirect("/home/calendar?reset=1");
}
