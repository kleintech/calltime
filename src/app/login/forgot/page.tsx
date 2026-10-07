import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center font-display text-3xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </Link>
      <Card className="p-6">
        <h1 className="font-display text-2xl font-semibold">Forgot your password?</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new one.</p>
        <ForgotForm />
      </Card>
    </main>
  );
}
