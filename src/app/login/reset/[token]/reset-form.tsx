"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { PasswordInput } from "@/app/invite/[token]/forms";
import { resetPassword, type ResetState } from "./actions";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, {});
  const [, start] = useTransition();
  return (
    // onSubmit (not <form action>) so the field isn't wiped when the server reports an error.
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
          <Notice
            tone="danger"
            action={
              state.expired ? (
                <Link href="/login/forgot" className="text-sm font-medium underline">
                  Get a new link
                </Link>
              ) : undefined
            }
          >
            {state.error}
          </Notice>
        </div>
      ) : null}
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" value={email} readOnly autoComplete="username" hidden />
      <Field label="New password" hint="At least 8 characters.">
        <PasswordInput autoComplete="new-password" />
      </Field>
      <Button type="submit" className="w-full" disabled={pending || !!state.expired}>
        {pending ? "Saving…" : "Save password and sign in"}
      </Button>
    </form>
  );
}
