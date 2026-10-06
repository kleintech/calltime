import { redirect } from "next/navigation";
import { LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-12">
      <h1 className="font-display text-5xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </h1>
      <p className="mt-4 text-lg text-muted">Know exactly when you&apos;re called. No more scrolling the chat.</p>
      <div className="mt-8">
        <LinkButton href="/login">Sign in</LinkButton>
      </div>
    </div>
  );
}
