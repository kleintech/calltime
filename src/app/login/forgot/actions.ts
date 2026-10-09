"use server";

import { z } from "zod";
import { normalizeEmail } from "@/lib/auth";
import { requestPasswordResetByEmail } from "@/lib/password-reset";

export type ForgotState = {
  error?: string;
  /** The email we (may have) sent a link to. Shown the same whether or not an account exists. */
  sent?: string;
  /** No mailer on this deployment: point them at their company admin instead. */
  noMailer?: boolean;
};

const schema = z.object({ email: z.email("Enter an email like name@example.com.").max(254) });

export async function requestReset(_: ForgotState, fd: FormData): Promise<ForgotState> {
  const parsed = schema.safeParse({ email: normalizeEmail(String(fd.get("email") ?? "")) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter your email." };
  const { email } = parsed.data;
  const result = await requestPasswordResetByEmail(email);
  if (!result.mailerConfigured) return { noMailer: true };
  if (result.error) return { error: result.error };
  return { sent: email };
}
