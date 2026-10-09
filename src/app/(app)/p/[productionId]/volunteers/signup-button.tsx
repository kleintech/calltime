"use client";

import { HandHeart } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { cancelVolunteer, volunteer } from "./actions";

/**
 * One-tap "I'll help" / "Cancel my spot". Calls the action directly (not useActionState) so the
 * confirmation toast still fires after the card moves to "My volunteer shifts" and this unmounts.
 */
export function SignupButton({ shiftId, mode, title }: { shiftId: string; mode: "join" | "cancel"; title: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("shiftId", shiftId);
      const res = await (mode === "join" ? volunteer({}, fd) : cancelVolunteer({}, fd));
      if (res.error) {
        setError(res.error);
        toast(res.error, { tone: "danger" });
      } else {
        toast(mode === "join" ? `You're signed up: ${title}` : `Cancelled: ${title}`, { tone: mode === "join" ? "success" : "neutral" });
      }
    });
  return (
    <div>
      {mode === "join" ? (
        <Button type="button" disabled={pending} onClick={run} className="w-full sm:w-auto">
          <HandHeart /> {pending ? "Signing up…" : "I'll help"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Cancel your spot on “${title}”?`)) run();
          }}
        >
          {pending ? "Cancelling…" : "Cancel my spot"}
        </Button>
      )}
      {error ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
