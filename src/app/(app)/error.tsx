"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, EmptyState, LinkButton } from "@/components/ui";

/** Signed-in routes: a failed load gets a way back and a retry, never a bare framework error page. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="pt-6">
      <EmptyState
        icon={<CircleAlert />}
        title="We couldn't load this page"
        body="Something went wrong on our side. Your calls are safe — try again, or head back to My Calls."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <LinkButton href="/home" variant="secondary">
              Back to Calls
            </LinkButton>
          </div>
        }
      />
      {error.digest ? <p className="mt-4 text-center text-xs text-muted">Reference {error.digest}</p> : null}
    </div>
  );
}
