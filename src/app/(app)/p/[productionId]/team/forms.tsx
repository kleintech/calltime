"use client";

import { useState } from "react";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";
import { CREATIVE_TITLES } from "@/app/(app)/productions/_components/constants";

function TitleField({ defaultValue }: { defaultValue?: string }) {
  const isCustom = !!defaultValue && !CREATIVE_TITLES.includes(defaultValue);
  const [sel, setSel] = useState(isCustom ? "__custom" : (defaultValue ?? "Director"));
  return (
    <div className="space-y-2">
      <Field label="Title">
        <Select name="title" value={sel} onChange={(e) => setSel(e.target.value)}>
          {CREATIVE_TITLES.map((t) => (
            <option key={t}>{t}</option>
          ))}
          <option value="__custom">Other…</option>
        </Select>
      </Field>
      {sel === "__custom" ? (
        <Input name="customTitle" required maxLength={60} defaultValue={isCustom ? defaultValue : ""} placeholder="Lighting Designer" aria-label="Custom title" />
      ) : null}
    </div>
  );
}

export function AddMemberForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email">
          <Input name="email" type="email" required maxLength={200} autoComplete="off" />
        </Field>
        <Field label="Name (optional)" hint="Used on the invite if they don't have an account yet.">
          <Input name="name" maxLength={120} autoComplete="off" />
        </Field>
      </div>
      <TitleField />
      <Checkbox name="canEdit" defaultChecked label="Can edit this production (scenes, cast, schedule)" />
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Adding…">
        Add to team
      </SubmitButton>
    </ActionForm>
  );
}

export function EditMemberForm({ action, title, canEdit }: { action: FormAction; title: string; canEdit: boolean }) {
  return (
    <ActionForm action={action}>
      <TitleField defaultValue={title} />
      <Checkbox name="canEdit" defaultChecked={canEdit} label="Can edit this production" />
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}
