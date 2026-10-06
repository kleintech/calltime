"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "@/components/toast";
import { Button, Notice, cn } from "@/components/ui";
import type { FormState } from "./form-state";
import { ShareInvite } from "./share-invite";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * A one-column form bound to a Server Action returning FormState. Shows errors / success and,
 * when the action returns an invite link, the link with a share/copy box.
 *
 * Submits via onSubmit + startTransition instead of <form action>, so React does NOT reset the
 * inputs — typed values survive a validation error. Pass resetOnSuccess for "add another" forms.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  submitVariant = "primary",
  className,
  resetOnSuccess = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitVariant?: Variant;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
    else if (state.ok && !state.link) toast(state.ok, { tone: "success" });
    if (!state.error && (state.ok || state.link) && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {state.error ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="outline-none">
          <Notice tone="danger">{state.error}</Notice>
        </div>
      ) : null}
      {state.link ? <InviteLinkBox key={state.link} url={state.link} title={state.ok} message={state.message} /> : null}
      {children}
      <Button type="submit" variant={submitVariant} disabled={pending} className="w-full sm:w-auto">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

export function InviteLinkBox({ url, title, message }: { url: string; title?: string; message?: string }) {
  return (
    <div role="status" className="space-y-3 rounded-xl border border-gold/40 bg-gold-soft p-3">
      <p className="font-medium text-ink">{title ?? "Invite link ready"}</p>
      <ShareInvite url={url} message={message ?? url} />
      <p className="text-xs text-muted">Send it by text, email or the group chat. It works once and expires in 30 days.</p>
    </div>
  );
}

/** Submit button for small inline forms (role changes, remove, revoke). Optional confirm prompt. */
export function SubmitButton({
  children,
  variant = "secondary",
  confirm,
  className,
  pendingLabel,
  size = "md",
}: {
  children: ReactNode;
  variant?: Variant;
  confirm?: string;
  className?: string;
  pendingLabel?: string;
  size?: "sm" | "md";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      size={size}
      className={cn(size === "md" && "px-3", className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
