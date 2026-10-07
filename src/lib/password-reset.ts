import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { hashPassword, normalizeEmail, randomToken, sha256 } from "@/lib/auth";
import { emailConfigured, escapeHtml, sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/invites";
import { clientIp, takeRateLimit } from "@/lib/rate-limit";

/*
 * One-time password reset links: /login/reset/<token>. Only the sha256 of the token is stored.
 * Two ways to get one: the public "Forgot password?" form (needs the mailer) or a company admin
 * issuing a link from Company → Members and sending it however they like.
 */

export const RESET_TTL_MS = 60 * 60_000;
export const RESET_TTL_LABEL = "1 hour";

type User = typeof users.$inferSelect;
type Reset = typeof passwordResets.$inferSelect;

export function resetUrl(baseUrl: string, token: string) {
  return `${baseUrl}/login/reset/${token}`;
}

/**
 * Mint a fresh link for a user. Any earlier link that hasn't been used stops working, so only the
 * newest one is live.
 */
export async function issuePasswordReset(userId: string, opts: { issuedByUserId?: string } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(passwordResets).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
    await tx.insert(passwordResets).values({
      userId,
      tokenHash: sha256(token),
      expiresAt,
      issuedByUserId: opts.issuedByUserId ?? null,
    });
  });
  return { token, url: resetUrl(await appBaseUrl(), token), expiresAt };
}

/** The reset row and its user when the token is live (exists, unused, not expired), else null. */
export async function findValidReset(token: string): Promise<{ reset: Reset; user: User } | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(
      and(
        eq(passwordResets.tokenHash, sha256(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Set the new password and burn the link, in one transaction so two submissions of the same link
 * can't both succeed. Every session of the user is deleted (the caller signs them in afresh).
 * Returns the user id, or null when the link is no longer valid.
 */
export async function completePasswordReset(token: string, password: string): Promise<string | null> {
  const tokenHash = sha256(token);
  const passwordHash = await hashPassword(password); // bcrypt outside the transaction
  return db.transaction(async (tx) => {
    const [reset] = await tx.select().from(passwordResets).where(eq(passwordResets.tokenHash, tokenHash)).for("update");
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) return null;
    const now = new Date();
    await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
    await tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id));
    await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
    return reset.userId;
  });
}

/**
 * Email the link. `requestedBy` is who asked for it, in words the recipient understands
 * ("Someone (probably you)", "Pat Okafor at Riverside Youth Theatre").
 */
export async function sendPasswordResetEmail(user: Pick<User, "email" | "name">, url: string, opts: { requestedBy: string }) {
  const first = user.name.trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${first},`,
    "",
    `${opts.requestedBy} asked to reset the password for your Calltime account (${user.email}).`,
    "",
    "Choose a new password here:",
    url,
    "",
    `The link expires in ${RESET_TTL_LABEL} and works once.`,
    "",
    "If you didn't ask for this, ignore this email — your password stays the same.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(first)},</p>`,
    `<p>${escapeHtml(opts.requestedBy)} asked to reset the password for your Calltime account (${escapeHtml(user.email)}).</p>`,
    `<p><a href="${escapeHtml(url)}">Choose a new password</a><br><span style="color:#666;font-size:13px">${escapeHtml(url)}</span></p>`,
    `<p>The link expires in ${RESET_TTL_LABEL} and works once.</p>`,
    `<p>If you didn't ask for this, ignore this email — your password stays the same.</p>`,
  ].join("\n");
  return sendEmail({
    to: user.email,
    subject: "Reset your Calltime password",
    text,
    html,
    idempotencyKey: `password-reset:${sha256(url)}`,
  });
}

/**
 * The public "Forgot password?" path. Never reveals whether the email has an account: callers show
 * the same message either way. `error` is set only when rate limited.
 */
export async function requestPasswordResetByEmail(
  rawEmail: string,
): Promise<{ delivered: boolean; mailerConfigured: boolean; error?: string }> {
  const email = normalizeEmail(rawEmail);
  const mailerConfigured = emailConfigured();
  if (!mailerConfigured) return { delivered: false, mailerConfigured };
  const limited = await takeRateLimit(
    [
      { key: `reset:ip:${await clientIp()}`, max: 10 },
      { key: `reset:email:${email}`, max: 5 },
    ],
    "Too many reset requests. Wait 15 minutes and try again.",
  );
  if (limited) return { delivered: false, mailerConfigured, error: limited };
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) return { delivered: false, mailerConfigured };
  const { url } = await issuePasswordReset(user.id);
  const sent = await sendPasswordResetEmail(user, url, { requestedBy: "Someone (probably you)" });
  if (!sent.ok) console.error("[password-reset] email failed:", sent.reason);
  return { delivered: sent.ok, mailerConfigured };
}
