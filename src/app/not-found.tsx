import { Drama } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

/**
 * 404 — also shown for pages you don't have access to. Signed-in users go back to Calls;
 * signed-out visitors (e.g. a mistyped audition link) go to the public home page instead of
 * bouncing through login.
 */
export default async function NotFound() {
  const user = await getCurrentUser();
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
      <EmptyState
        icon={<Drama />}
        title="This page isn't on the call sheet"
        body="It may have moved, been cancelled, or belong to a show you're not part of."
        action={user ? <LinkButton href="/home">Back to Calls</LinkButton> : <LinkButton href="/">Go to Calltime home</LinkButton>}
      />
    </div>
  );
}
