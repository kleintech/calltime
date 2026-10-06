"use client";

import { Field, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "../_components/form";
import { createProduction } from "./actions";
import type { ReactNode } from "react";

export function NewProductionForm({ orgs, fields }: { orgs: { id: string; name: string }[]; fields: ReactNode }) {
  return (
    <ActionForm action={createProduction}>
      {orgs.length > 1 ? (
        <Field label="Company">
          <Select name="orgId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="orgId" value={orgs[0]?.id ?? ""} />
      )}
      {fields}
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Creating…">
        Create production
      </SubmitButton>
    </ActionForm>
  );
}
