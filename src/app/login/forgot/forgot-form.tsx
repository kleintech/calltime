"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { requestReset, type ForgotState } from "./actions";

const backLink = "inline-flex min-h-11 items-center text-sm font-medium text-accent";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, {});
  const [, start] = useTransition();

  if (state.sent) {
    return (
      <div role="status" className="space-y-4">
        <Notice tone="success">
          If there&apos;s a Calltime account for <span className="font-medium">{state.sent}</span>, we&apos;ve sent a link. It
          expires in an hour.
        </Notice>
        <p className="text-sm text-muted">Nothing after a few minutes? Check spam, or ask your company&apos;s admin for a link.</p>
        <Link href="/login" className={backLink}>
          ← Back to sign in
        </Link>
      </div>
    );
  }

  if (state.noMailer) {
    return (
      <div role="status" className="space-y-4">
        <Notice tone="warn">
          Email isn&apos;t set up for this Calltime yet. Ask your company&apos;s admin or stage manager to send you a reset link —
          they can do it from Company → Members.
        </Notice>
        <Link href="/login" className={backLink}>
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    // onSubmit (not <form action>) so the typed email survives an error.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(() => action(fd));
      }}
      className="space-y-4"
    >
      {state.error ? (
        <div role="alert">
          <Notice tone="danger">{state.error}</Notice>
        </div>
      ) : null}
      <Field label="Email" hint="The one you sign in with.">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
      <p className="text-center">
        <Link href="/login" className={backLink}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
