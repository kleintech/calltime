"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { buttonClass, cn } from "@/components/ui";
import { acknowledgeEvent } from "../actions";

/** Big, obvious acknowledgement so families can clear a change once they've read it. */
export function GotItButton({ eventId, revision, className }: { eventId: string; revision: number; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={cn(buttonClass("primary"), "min-w-28", className)}
      onClick={() =>
        start(async () => {
          const r = await acknowledgeEvent(eventId, revision);
          if (!r.ok) toast(r.error ?? "Couldn't save", { tone: "danger" });
          router.refresh();
        })
      }
    >
      <Check className="size-4" /> {pending ? "Saving…" : "Got it"}
    </button>
  );
}
