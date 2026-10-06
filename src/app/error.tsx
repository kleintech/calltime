"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, EmptyState, LinkButton } from "@/components/ui";

/** Public routes (sign-in, invites, audition signup): what happened, what to do, a way out. */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <EmptyState
        icon={<CircleAlert />}
        title="Something went wrong"
        body="We couldn't load this page. Try again in a moment — if it keeps happening, the link you opened may be out of date."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <LinkButton href="/" variant="secondary">
              Go to Calltime
            </LinkButton>
          </div>
        }
      />
      {error.digest ? <p className="mt-4 text-center text-xs text-muted">Reference {error.digest}</p> : null}
    </main>
  );
}
