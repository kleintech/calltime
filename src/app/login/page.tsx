import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/home");
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center font-display text-3xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </Link>
      <Card className="p-6">
        <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
        <LoginForm next={typeof next === "string" ? next : undefined} />
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        New here? Ask your director for an invite link.
      </p>
    </div>
  );
}
