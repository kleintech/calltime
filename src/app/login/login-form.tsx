"use client";

import { useActionState, useTransition } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [, start] = useTransition();
  return (
    // onSubmit (not <form action>) so the email isn't wiped after a wrong password.
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
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
