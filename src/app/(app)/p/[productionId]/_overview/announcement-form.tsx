"use client";

import { Checkbox, Field, Input, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";

export function AnnouncementForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <Field label="Title">
        <Input name="title" required maxLength={200} placeholder="Off-book for Act 1 by Monday" />
      </Field>
      <Field label="Message">
        <Textarea name="body" required maxLength={5000} />
      </Field>
      <Checkbox name="pinned" label="Pin to the top" />
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Posting…">
        Post announcement
      </SubmitButton>
    </ActionForm>
  );
}
