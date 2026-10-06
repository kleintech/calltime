"use client";

import { useState } from "react";
import { Field, Input, Textarea, cn } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";

export type RoleOption = { id: string; name: string; kind: string };
type SceneValues = {
  act: number;
  number: string;
  name: string;
  description: string | null;
  songs: string | null;
  pages: string | null;
};

const KIND_LABEL: Record<string, string> = { lead: "Leads", supporting: "Supporting", featured: "Featured", ensemble: "Ensemble" };

/** Create/edit a scene, including which roles appear in it (the breakdown, scene side). */
export function SceneForm({
  action,
  scene,
  roles,
  selectedRoleIds = [],
  submitLabel,
  resetOnSuccess,
  successMessage,
}: {
  action: FormAction;
  scene?: SceneValues;
  roles: RoleOption[];
  selectedRoleIds?: string[];
  submitLabel: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
}) {
  const [k, setK] = useState(0);
  return (
    <ActionForm
      action={action}
      resetOnSuccess={resetOnSuccess}
      successMessage={successMessage}
      onSuccess={resetOnSuccess ? () => setK((n) => n + 1) : undefined}
    >
      <div className="grid grid-cols-[5rem_6rem_1fr] gap-3 max-sm:grid-cols-2">
        <Field label="Act">
          <Input name="act" type="number" inputMode="numeric" min={0} max={20} required defaultValue={scene?.act ?? 1} />
        </Field>
        <Field label="Scene #">
          <Input name="number" required maxLength={20} defaultValue={scene?.number ?? ""} placeholder="3A" />
        </Field>
        <Field label="Name" className="max-sm:col-span-2">
          <Input name="name" required maxLength={200} defaultValue={scene?.name ?? ""} placeholder="The Pirate Cave" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Songs (optional)" hint="Comma separated">
          <Input name="songs" maxLength={1000} defaultValue={scene?.songs ?? ""} />
        </Field>
        <Field label="Pages (optional)">
          <Input name="pages" maxLength={50} defaultValue={scene?.pages ?? ""} placeholder="12–18" />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea name="description" maxLength={2000} defaultValue={scene?.description ?? ""} className="min-h-16" />
      </Field>
      <RolePicker key={k} roles={roles} selected={selectedRoleIds} />
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

function RolePicker({ roles, selected }: { roles: RoleOption[]; selected: string[] }) {
  const [sel, setSel] = useState(() => new Set(selected));
  if (roles.length === 0) {
    return <p className="text-sm text-muted">Add roles first, then pick who appears in this scene.</p>;
  }
  const kinds = ["lead", "supporting", "featured", "ensemble"].filter((k) => roles.some((r) => r.kind === k));
  return (
    <fieldset className="space-y-2">
      <input type="hidden" name="hasRoles" value="1" />
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">Roles in this scene</legend>
        <span className="text-xs text-muted">{sel.size} selected</span>
      </div>
      {kinds.map((k) => (
        <div key={k}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{KIND_LABEL[k]}</p>
          <div className="flex flex-wrap gap-2">
            {roles
              .filter((r) => r.kind === k)
              .map((r) => {
                const on = sel.has(r.id);
                return (
                  <label
                    key={r.id}
                    className={cn(
                      "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm select-none",
                      on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="roleIds"
                      value={r.id}
                      checked={on}
                      onChange={(e) => {
                        const next = new Set(sel);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        setSel(next);
                      }}
                      className="sr-only"
                    />
                    {on ? "✓ " : ""}
                    {r.name}
                  </label>
                );
              })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
