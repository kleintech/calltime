"use client";

import { CopyPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, buttonClass } from "@/components/ui";
import { duplicateEvent } from "../actions";

/** "Duplicate" → pick a date → copy lands as a draft and opens in the editor. */
export function DuplicateButton({ productionId, eventId, defaultDate }: { productionId: string; eventId: string; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)}>
        <CopyPlus className="size-4" /> Duplicate
      </button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 sm:w-auto">
      <label className="text-sm font-medium" htmlFor="dup-date">
        Copy to
      </label>
      <Input id="dup-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto flex-1" />
      <Button
        type="button"
        disabled={pending || !date}
        onClick={() =>
          start(async () => {
            const r = await duplicateEvent(productionId, eventId, date);
            if (!r.ok) return setError(r.error);
            router.push(`/p/${productionId}/schedule/${r.id}/edit`);
          })
        }
      >
        {pending ? "Copying…" : "Copy as draft"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
