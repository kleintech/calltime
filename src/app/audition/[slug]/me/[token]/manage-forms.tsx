"use client";

import { startTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Notice, Select, Textarea } from "@/components/ui";
import { changeSlot, updateConflicts, withdrawSignup, type PublicFormState } from "../../actions";
import { ConflictPicker, type ConflictRow } from "../../conflict-picker";

function Submit({ children, variant = "primary", confirmMessage }: { children: string; variant?: "primary" | "secondary" | "danger"; confirmMessage?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      className="w-full sm:w-auto"
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? "One moment…" : children}
    </Button>
  );
}

export function ChangeSlotForm({ slug, token, options }: { slug: string; token: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState<PublicFormState, FormData>(changeSlot, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Field label="New audition time">
        <Select name="slotId" required defaultValue="">
          <option value="" disabled>
            Choose a new time…
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Submit variant="secondary">Change my time</Submit>
    </form>
  );
}

export function WithdrawForm({ slug, token }: { slug: string; token: string }) {
  return (
    <form action={withdrawSignup}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <Submit variant="danger" confirmMessage="Withdraw from auditions? Your time slot will be released.">
        Withdraw from auditions
      </Submit>
    </form>
  );
}

export function ConflictsForm({
  slug,
  token,
  initial,
  notes,
  min,
  max,
}: {
  slug: string;
  token: string;
  initial: ConflictRow[];
  notes: string | null;
  min?: string;
  max?: string;
}) {
  const [state, action, pending] = useActionState<PublicFormState, FormData>(updateConflicts, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        // No automatic reset: keep the rows as typed after saving or on an error.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <ConflictPicker initial={initial} min={min} max={max} error={state.fieldErrors?.conflictDates} />
      <Field label="Anything else about your availability? (optional)">
        <Textarea name="conflictsText" rows={2} defaultValue={notes ?? ""} />
      </Field>
      {state.error && !state.fieldErrors ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : "Save my dates"}
      </Button>
    </form>
  );
}
