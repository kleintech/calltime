"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { completePasswordReset } from "@/lib/password-reset";

export type ResetState = {
  error?: string;
  /** The link stopped being valid between page load and submit; the form offers a way to get a new one. */
  expired?: boolean;
};

const schema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8, "Use at least 8 characters.").max(200, "Use at most 200 characters."),
});

export async function resetPassword(_: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = schema.safeParse({ token: fd.get("token"), password: fd.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const userId = await completePasswordReset(parsed.data.token, parsed.data.password);
  if (!userId) return { error: "This reset link has expired. Get a new one and try again.", expired: true };
  await createSession(userId);
  redirect("/home");
}
