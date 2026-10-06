"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, buttonClass } from "@/components/ui";
import { setEventStatus } from "../actions";

/** Cancel a published event, with an optional reason shown to families. */
export function CancelEventButton({ productionId, eventId, people, what }: { productionId: string; eventId: string; people: number; what: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" className={buttonClass("danger")} onClick={() => setOpen(true)}>
        <Ban className="size-4" /> Cancel event
      </button>
    );
  return (
    <div className="w-full space-y-3 rounded-2xl border border-danger/40 bg-danger-soft/40 p-3">
      <p className="text-sm font-medium">
        Cancel {what}? {people} {people === 1 ? "person" : "people"} will see it struck through as Cancelled, and it updates in their calendars.
      </p>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Note for families (optional)</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Auditorium unavailable" />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setEventStatus(productionId, eventId, "cancel", reason);
              if (!r.ok) return setError(r.error);
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? "Cancelling…" : "Cancel event"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
