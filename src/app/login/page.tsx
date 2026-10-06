import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getCurrentUser, safeNextPath } from "@/lib/auth";
import { demoEnabled } from "@/lib/demo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;
  if (await getCurrentUser()) redirect(safeNext ?? "/home");
  const fromInvite = safeNext?.startsWith("/invite/");
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center font-display text-3xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </Link>
      <Card className="p-6">
        <h1 className="font-display text-2xl font-semibold">{fromInvite ? "Sign in to accept" : "Welcome back"}</h1>
        <p className="mb-5 mt-1 text-sm text-muted">
          {fromInvite ? "Sign in and we'll take you straight back to your invite." : "Sign in to see your calls."}
        </p>
        <LoginForm next={safeNext} />
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        New here? Your company sends you an invite link — open it to create your account.
      </p>
      {demoEnabled() ? (
        <p className="mt-2 text-center text-sm">
          <Link href="/#demo" className="font-medium text-accent">
            Just looking? Try the demo →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
