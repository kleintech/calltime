"use client";

import { Check, Share2 } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CopyButton } from "@/components/copy-button";
import { toast } from "@/components/toast";
import { Button, Notice, buttonClass, cn } from "@/components/ui";
import type { FormState } from "@/lib/production-queries";

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const PendingContext = createContext(false);

/**
 * A form bound to a server action via useActionState. Shows the action's error/success inline,
 * and an invite link with a copy button when the action returns one.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage,
  onSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  onSuccess?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const lastNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.ok && state.nonce && state.nonce !== lastNonce.current) {
      lastNonce.current = state.nonce;
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  const msg = state.ok ? (state.message ?? successMessage) : undefined;
  // Success confirms with a toast (the form stays clean); invite links still render inline below.
  useEffect(() => {
    if (msg && !state.inviteUrl) toast(msg, { tone: "success" });
  }, [state, msg]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        // Submit manually so React doesn't auto-reset the form: on a validation error the user
        // keeps what they typed. Successful submits reset only when resetOnSuccess is set.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {children}
        {state.ok && state.inviteUrl ? <InviteLink url={state.inviteUrl} message={msg} shareText={state.shareText} /> : null}
      </PendingContext.Provider>
    </form>
  );
}

export function InviteLink({ url, message, shareText }: { url: string; message?: string; shareText?: string }) {
  const [text, setText] = useState(shareText ? `${shareText}\n${url}` : url);
  return (
    <div className="space-y-3 rounded-xl bg-success-soft p-3">
      <p className="text-sm text-success">{message ?? "Invite link created. Send it however you like."}</p>
      {shareText ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink">Message (you can edit it)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
      ) : (
        <code className="block truncate rounded-lg bg-surface px-2 py-2 text-xs">{url}</code>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {shareText ? <ShareTextButton text={text} /> : null}
        <CopyButton value={url} share={!shareText} />
      </div>
    </div>
  );
}

/** Opens the phone's share sheet with a prewritten message; copies it where sharing isn't available. */
function ShareTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("primary")}
      onClick={async () => {
        if (typeof navigator !== "undefined" && "share" in navigator) {
          try {
            await navigator.share({ text });
            return;
          } catch {
            /* cancelled or unsupported: fall back to copying */
          }
        }
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Message copied" : "Send invite"}
    </button>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}

/** Tiny icon-sized submit (reorder arrows etc). */
export function IconSubmit({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={pending}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A form whose submit asks for confirmation first (deletes, removals). */
export function ConfirmForm({
  action,
  confirm,
  children,
  className,
}: {
  action: (fd: FormData) => void | Promise<void>;
  confirm: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
