"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea, cn } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";
import { ColorPicker } from "@/app/(app)/productions/_components/color-picker";
import { ROLE_KINDS, ROLE_KIND_SINGULAR } from "@/app/(app)/productions/_components/constants";

export function RoleForm({
  action,
  role,
  submitLabel,
  resetOnSuccess,
}: {
  action: FormAction;
  role?: { name: string; kind: string; description: string | null };
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess}>
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <Field label="Role name">
          <Input name="name" required maxLength={120} defaultValue={role?.name ?? ""} placeholder="Mabel" />
        </Field>
        <Field label="Kind">
          <Select name="kind" defaultValue={role?.kind ?? "supporting"}>
            {ROLE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {ROLE_KIND_SINGULAR[k.value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description (optional)" hint="Voice type, age range, notes for auditions…">
        <Textarea name="description" maxLength={2000} defaultValue={role?.description ?? ""} className="min-h-16" />
      </Field>
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export type RoleOption = { id: string; name: string; kind: string };

export function GroupForm({
  action,
  group,
  roles,
  selected = [],
  submitLabel,
  resetOnSuccess,
}: {
  action: FormAction;
  group?: { name: string; color: string | null };
  roles: RoleOption[];
  selected?: string[];
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  const [k, setK] = useState(0);
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} onSuccess={resetOnSuccess ? () => setK((n) => n + 1) : undefined}>
      <Field label="Group name">
        <Input name="name" required maxLength={120} defaultValue={group?.name ?? ""} placeholder="Pirates" />
      </Field>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Color</span>
        <ColorPicker key={k} name="color" defaultValue={group?.color ?? null} allowNone />
      </div>
      <RoleChips key={`r${k}`} roles={roles} selected={selected} />
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

function RoleChips({ roles, selected }: { roles: RoleOption[]; selected: string[] }) {
  const [sel, setSel] = useState(() => new Set(selected));
  if (!roles.length) return <p className="text-sm text-muted">Add roles first.</p>;
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Roles in this group</legend>
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => {
          const on = sel.has(r.id);
          return (
            <label
              key={r.id}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-sm select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface",
              )}
            >
              <input
                type="checkbox"
                name="roleIds"
                value={r.id}
                checked={on}
                className="sr-only"
                onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  setSel(next);
                }}
              />
              {on ? "✓ " : ""}
              {r.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
