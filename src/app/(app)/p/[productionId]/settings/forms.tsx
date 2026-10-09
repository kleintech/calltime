"use client";

import type { ReactNode } from "react";
import { Field, Input } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";

export function SettingsForm({ action, fields }: { action: FormAction; fields: ReactNode }) {
  return (
    <ActionForm action={action}>
      {fields}
      <SubmitButton className="w-full sm:w-auto">Save production</SubmitButton>
    </ActionForm>
  );
}

export function DeleteForm({ action, title }: { action: FormAction; title: string }) {
  return (
    <ActionForm action={action}>
      <Field label={`Type “${title}” to confirm`}>
        <Input name="confirm" autoComplete="off" required />
      </Field>
      <SubmitButton variant="danger" pendingLabel="Deleting…" className="w-full sm:w-auto">
        Delete production forever
      </SubmitButton>
    </ActionForm>
  );
}
