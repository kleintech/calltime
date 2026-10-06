"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { randomToken, requireUser } from "@/lib/auth";

/** Rotate the signed-in user's calendar token. Every existing subscription stops updating. */
export async function resetCalendarLink() {
  const user = await requireUser();
  await db.update(users).set({ calendarToken: randomToken(24) }).where(eq(users.id, user.id));
  revalidatePath("/home/calendar");
  redirect("/home/calendar?reset=1");
}
