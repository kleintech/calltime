"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { acceptAsCurrentUser, acceptWithNewAccount, signInAndAccept, type AcceptState } from "./actions";

type Action = (s: AcceptState, fd: FormData) => Promise<AcceptState>;

/** useActionState submitted via onSubmit, so typed values aren't wiped when there's an error. */
function useKeepValuesAction(action: Action) {
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(action, {});
  const [, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => formAction(fd));
  };
  return { state, onSubmit, pending };
}

function PasswordInput({ autoComplete }: { autoComplete: "new-password" | "current-password" }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        name="password"
        type={show ? "text" : "password"}
        required
        minLength={autoComplete === "new-password" ? 8 : undefined}
        autoComplete={autoComplete}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-muted hover:text-ink"
      >
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}

function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <div role="alert">
      <Notice tone="danger">{error}</Notice>
    </div>
  ) : null;
}

export function CreateAccountForm({ token, email, name, cta }: { token: string; email: string; name: string; cta: string }) {
  const { state, onSubmit, pending } = useKeepValuesAction(acceptWithNewAccount);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ErrorNotice error={state.error} />
      <input type="hidden" name="token" value={token} />
      <Field label="Your name">
        <Input name="name" required defaultValue={name} autoComplete="name" />
      </Field>
      <Field label="Email" hint="You'll sign in with this.">
        <Input type="email" name="username" value={email} readOnly autoComplete="username" className="bg-surface-2 text-muted" />
      </Field>
      <Field label="Create a password" hint="At least 8 characters.">
        <PasswordInput autoComplete="new-password" />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Setting up…" : cta}
      </Button>
    </form>
  );
}

export function SignInAcceptForm({ token, email, cta }: { token: string; email: string; cta: string }) {
  const { state, onSubmit, pending } = useKeepValuesAction(signInAndAccept);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ErrorNotice error={state.error} />
      <input type="hidden" name="token" value={token} />
      <input type="email" name="username" value={email} readOnly autoComplete="username" hidden />
      <Field label={`Password for ${email}`}>
        <PasswordInput autoComplete="current-password" />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : cta}
      </Button>
    </form>
  );
}

export function AcceptForm({ token, cta }: { token: string; cta: string }) {
  const { state, onSubmit, pending } = useKeepValuesAction(acceptAsCurrentUser);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <ErrorNotice error={state.error} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Adding…" : cta}
      </Button>
    </form>
  );
}
