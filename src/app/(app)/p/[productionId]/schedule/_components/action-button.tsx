"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { buttonClass, cn } from "@/components/ui";

type Result = { ok: true; id?: string; count?: number } | { ok: false; error: string };

/**
 * Runs a bound server action from a button, with optional confirm(), pending state, inline error,
 * and navigation afterwards (`{id}` in `then` is replaced with the returned id).
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  confirm,
  then,
  variant = "secondary",
  className,
  doneMessage,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  pendingLabel?: string;
  confirm?: string;
  then?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  /** Shown after success; "{count}" is replaced with the returned count. */
  doneMessage?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        className={buttonClass(variant, className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setMsg(null);
          start(async () => {
            const r = await action();
            if (!r.ok) return setMsg({ tone: "error", text: r.error });
            if (doneMessage) setMsg({ tone: "ok", text: doneMessage.replace("{count}", String(r.count ?? "")) });
            if (then) router.push(then.replace("{id}", r.id ?? ""));
            else router.refresh();
          });
        }}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {msg ? (
        <span role="status" className={cn("mt-1 text-xs", msg.tone === "error" ? "text-danger" : "text-success")}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}
