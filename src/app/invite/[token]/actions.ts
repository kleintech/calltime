"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { createSession, destroySession, getCurrentUser, verifyPassword } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";
import { acceptInvite, InviteError, landingFor } from "./accept";

export type AcceptState = { error?: string };

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

async function run(fn: () => Promise<string>): Promise<AcceptState> {
  let dest: string;
  try {
    dest = await fn();
  } catch (e) {
    if (e instanceof InviteError) return { error: e.message };
    throw e;
  }
  redirect(dest);
}

/** Accept as the signed-in user. */
export async function acceptAsCurrentUser(_: AcceptState, fd: FormData): Promise<AcceptState> {
  const token = tokenSchema.parse(fd.get("token"));
  const user = await getCurrentUser();
  if (!user) return { error: "You've been signed out. Sign in again to accept." };
  return run(async () => landingFor((await acceptInvite(token, { asUserId: user.id })).invite));
}

/** Create the account for the invite's email, accept, and sign in. */
export async function acceptWithNewAccount(_: AcceptState, fd: FormData): Promise<AcceptState> {
  const token = tokenSchema.parse(fd.get("token"));
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Enter your name.").max(120),
      password: z.string().min(8, "Use a password of at least 8 characters.").max(200),
    })
    .safeParse({ name: fd.get("name") ?? "", password: fd.get("password") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  return run(async () => {
    const { userId, invite } = await acceptInvite(token, parsed.data);
    await createSession(userId);
    return landingFor(invite);
  });
}

/** The invite's email already has an account: check its password, accept as it, sign in. */
export async function signInAndAccept(_: AcceptState, fd: FormData): Promise<AcceptState> {
  const token = tokenSchema.parse(fd.get("token"));
  const password = String(fd.get("password") ?? "");
  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) });
  if (!invite) return { error: "This invite link isn't valid any more." };
  const limited = await checkLoginRateLimit(invite.email);
  if (limited) return { error: limited };
  const user = await db.query.users.findFirst({ where: eq(users.email, invite.email) });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await recordLoginFailure(invite.email);
    return { error: "That password isn't right." };
  }
  await clearLoginFailures(invite.email);
  return run(async () => {
    const { invite: accepted } = await acceptInvite(token, { asUserId: user.id });
    await createSession(user.id);
    return landingFor(accepted);
  });
}

/** "Use a different account": sign out but stay on the invite. */
export async function signOutToInvite(fd: FormData) {
  const token = tokenSchema.parse(fd.get("token"));
  await destroySession();
  redirect(`/invite/${token}`);
}
