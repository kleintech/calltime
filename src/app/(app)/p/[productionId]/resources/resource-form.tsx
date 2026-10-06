"use client";

import { Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";
import { RESOURCE_KIND_OPTIONS } from "@/app/(app)/productions/_components/constants";

type Opt = { id: string; label: string };

/**
 * Add a link. Pass `fixed` to pin it to a scene/role (scene and role edit pages); otherwise the
 * editor may choose a scene and/or role, or leave both empty for a production-wide link.
 */
export function ResourceForm({
  action,
  fixed,
  scenes = [],
  roles = [],
}: {
  action: FormAction;
  fixed?: { sceneId?: string; roleId?: string };
  scenes?: Opt[];
  roles?: Opt[];
}) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <Field label="Link" hint="Google Drive, YouTube, Dropbox, a PDF… anything with a web address.">
        <Input name="url" type="url" inputMode="url" required maxLength={2000} placeholder="https://" autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Name">
          <Input name="title" required maxLength={200} placeholder="Poor Wand'ring One — vocal track" autoComplete="off" />
        </Field>
        <Field label="Type">
          <Select name="kind" defaultValue="auto">
            <option value="auto">Detect from link</option>
            {RESOURCE_KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {fixed ? (
        <>
          {fixed.sceneId ? <input type="hidden" name="sceneId" value={fixed.sceneId} /> : null}
          {fixed.roleId ? <input type="hidden" name="roleId" value={fixed.roleId} /> : null}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="For scene (optional)">
            <Select name="sceneId" defaultValue="">
              <option value="">Whole show</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="For role (optional)" hint="Only people in this role see it.">
            <Select name="roleId" defaultValue="">
              <option value="">Everyone</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Adding…">
        Add link
      </SubmitButton>
    </ActionForm>
  );
}
