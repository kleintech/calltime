"use client";

import { Check, HandHeart } from "lucide-react";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { cancelVolunteer, volunteer, type SignupState } from "./actions";

/** One-tap "I'll help" / "Cancel" for a shift. */
export function SignupButton({ shiftId, mode, title }: { shiftId: string; mode: "join" | "cancel"; title: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(mode === "join" ? volunteer : cancelVolunteer, {});
  useEffect(() => {
    if (state.done) toast(mode === "join" ? `You're signed up: ${title}` : `Cancelled: ${title}`, { tone: mode === "join" ? "success" : "neutral" });
    if (state.error) toast(state.error, { tone: "danger" });
  }, [state, mode, title]);
  return (
    <form action={action}>
      <input type="hidden" name="shiftId" value={shiftId} />
      {mode === "join" ? (
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          <HandHeart /> {pending ? "Signing up…" : "I'll help"}
        </Button>
      ) : (
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm(`Cancel your spot on “${title}”?`)) e.preventDefault();
          }}
        >
          {pending ? "Cancelling…" : "Cancel my spot"}
        </Button>
      )}
      {state.error ? <p className="mt-2 text-sm text-danger" role="alert">{state.error}</p> : null}
      {state.done && mode === "join" ? (
        <p className="sr-only" role="status">
          <Check /> Signed up
        </p>
      ) : null}
    </form>
  );
}
