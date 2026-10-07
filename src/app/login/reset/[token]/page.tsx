import type { Metadata } from "next";
import Link from "next/link";
import { Card, LinkButton } from "@/components/ui";
import { findValidReset } from "@/lib/password-reset";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ params }: PageProps<"/login/reset/[token]">) {
  const { token } = await params;
  const valid = await findValidReset(token);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center font-display text-3xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </Link>
      {valid ? (
        <Card className="p-6">
          <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
          <p className="mb-5 mt-1 text-sm text-muted">
            For <span className="font-medium text-ink">{valid.user.email}</span>. You&apos;ll be signed in right after, and signed
            out everywhere else.
          </p>
          <ResetForm token={token} email={valid.user.email} />
        </Card>
      ) : (
        <Card className="p-6 text-center">
          <h1 className="font-display text-2xl font-semibold">This reset link has expired</h1>
          <p className="mt-2 text-base text-muted">Reset links work once and last an hour. Ask for a fresh one and try again.</p>
          <div className="mt-5 flex flex-col gap-2">
            <LinkButton href="/login/forgot">Get a new link</LinkButton>
          </div>
          <p className="mt-4 text-sm text-muted">
            Remembered it?{" "}
            <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-accent">
              Sign in
            </Link>
          </p>
        </Card>
      )}
    </main>
  );
}
