"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, normalizeEmail, safeNextPath, verifyPassword } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";

export type LoginState = { error?: string };

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));
  const limited = await checkLoginRateLimit(email);
  if (limited) return { error: limited };
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await recordLoginFailure(email);
    return { error: "That email and password don't match." };
  }
  await clearLoginFailures(email);
  await createSession(user.id);
  redirect(next ?? "/home");
}
