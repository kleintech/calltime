import { Drama } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/ui";

/** 404 — also shown for pages you don't have access to. Always offers a way back to Calls. */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
      <EmptyState
        icon={<Drama />}
        title="This page isn't on the call sheet"
        body="It may have moved, been cancelled, or belong to a show you're not part of."
        action={<LinkButton href="/home">Back to Calls</LinkButton>}
      />
    </div>
  );
}
