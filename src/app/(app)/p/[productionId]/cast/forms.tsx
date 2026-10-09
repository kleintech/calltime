"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, Field, Input, Select, cn } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/app/(app)/productions/_components/form";
import { ASSIGNMENT_KINDS, ROLE_KINDS } from "@/app/(app)/productions/_components/constants";

export type RoleOpt = { id: string; name: string; kind: string; castCount: number };
export type PersonOpt = { id: string; name: string; isMinor: boolean; inCast: boolean };

function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="grid grid-flow-col gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup">
      <input type="hidden" name={name} value={value} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-10 rounded-lg px-3 text-sm font-medium",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RoleSelect({ roles, defaultValue }: { roles: RoleOpt[]; defaultValue?: string }) {
  return (
    <Select name="roleId" required defaultValue={defaultValue ?? ""}>
      <option value="" disabled>
        Choose a role…
      </option>
      {ROLE_KINDS.map((k) => {
        const list = roles.filter((r) => r.kind === k.value);
        if (!list.length) return null;
        return (
          <optgroup key={k.value} label={k.label}>
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.castCount === 0 ? " (not cast)" : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </Select>
  );
}

function KindSelect({ defaultValue = "primary" }: { defaultValue?: string }) {
  return (
    <Select name="kind" defaultValue={defaultValue}>
      {ASSIGNMENT_KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </Select>
  );
}

/** Cast someone in a role: pick an existing company person, or add a new one (with a guardian for minors). */
export function AssignForm({
  action,
  roles,
  people,
  defaultRoleId,
}: {
  action: FormAction;
  roles: RoleOpt[];
  people: PersonOpt[];
  defaultRoleId?: string;
}) {
  const [mode, setMode] = useState<"existing" | "new">(people.length ? "existing" : "new");
  const [minor, setMinor] = useState(false);
  if (!roles.length) return <p className="text-sm text-muted">Add roles first (Roles tab), then cast them here.</p>;
  return (
    <ActionForm action={action} resetOnSuccess onSuccess={() => setMinor(false)}>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="Role">
          <RoleSelect roles={roles} defaultValue={defaultRoleId} />
        </Field>
        <Field label="As">
          <KindSelect />
        </Field>
      </div>
      <Segmented
        name="mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "existing", label: "Existing person" },
          { value: "new", label: "New person" },
        ]}
      />
      {mode === "existing" ? (
        <Field label="Person" hint="Everyone in your company, including past productions.">
          <Select name="personId" required defaultValue="">
            <option value="" disabled>
              Choose a person…
            </option>
            {people.some((p) => p.inCast) ? (
              <optgroup label="Already in this cast">
                {people
                  .filter((p) => p.inCast)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ) : null}
            <optgroup label="Company">
              {people
                .filter((p) => !p.inCast)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isMinor ? " (minor)" : ""}
                  </option>
                ))}
            </optgroup>
          </Select>
        </Field>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input name="firstName" required maxLength={80} autoComplete="off" />
            </Field>
            <Field label="Last name (optional)">
              <Input name="lastName" maxLength={80} autoComplete="off" />
            </Field>
          </div>
          <Checkbox name="isMinor" label="Under 18? (their parents or guardians get the calls)" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={minor ? "Performer email (optional)" : "Email (optional)"} hint="Needed later to invite them to the app.">
              <Input name="email" type="email" maxLength={200} autoComplete="off" />
            </Field>
            <Field label="Phone (optional)">
              <Input name="phone" type="tel" maxLength={40} autoComplete="off" />
            </Field>
          </div>
          {minor ? (
            <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-sm font-medium">Parent / guardian (optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <Input name="guardianFirstName" maxLength={80} autoComplete="off" />
                </Field>
                <Field label="Last name (optional)">
                  <Input name="guardianLastName" maxLength={80} autoComplete="off" placeholder="Same as performer" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email" hint="To send them an invite link.">
                  <Input name="guardianEmail" type="email" maxLength={200} autoComplete="off" />
                </Field>
                <Field label="Phone (optional)">
                  <Input name="guardianPhone" type="tel" maxLength={40} autoComplete="off" />
                </Field>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Casting…">
        Add to cast
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Change an assignment's kind. Explicit "Change" + confirmation: understudies aren't called by scene
 * calls, so this changes someone's upcoming calls and notifies their family.
 */
export function AssignmentKindSelect({
  action,
  value,
  name,
  roleName,
}: {
  action: (fd: FormData) => Promise<void>;
  value: string;
  name: string;
  roleName: string;
}) {
  const [kind, setKind] = useState(value);
  const [pending, start] = useTransition();
  const label = ASSIGNMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
  return (
    <form
      className="flex items-center gap-1.5"
      action={(fd) => {
        const msg =
          kind === "primary"
            ? `Make ${name} a primary ${roleName}? They'll be called whenever ${roleName}'s scenes rehearse, and their family is notified of any new calls.`
            : `Make ${name} the ${label.toLowerCase()} for ${roleName}? ${label}s aren't called by scene calls, so their upcoming calls change and their family is notified.`;
        if (!window.confirm(msg)) return;
        start(() => action(fd));
      }}
    >
      <select
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        aria-label={`${roleName}: assignment type`}
        className="min-h-11 rounded-xl border border-line bg-surface px-2 text-base"
      >
        {ASSIGNMENT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      {kind !== value ? (
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Change"}
        </Button>
      ) : null}
    </form>
  );
}

export function AddRoleForm({ action, roles }: { action: FormAction; roles: RoleOpt[] }) {
  if (!roles.length) return <p className="text-sm text-muted">They already hold every role.</p>;
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label="Role">
          <RoleSelect roles={roles} />
        </Field>
        <Field label="As">
          <KindSelect />
        </Field>
        <SubmitButton>Add role</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PersonForm({
  action,
  person,
}: {
  action: FormAction;
  person: { firstName: string; lastName: string; email: string | null; phone: string | null; isMinor: boolean };
}) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input name="firstName" required maxLength={80} defaultValue={person.firstName} />
        </Field>
        <Field label="Last name (optional)">
          <Input name="lastName" maxLength={80} defaultValue={person.lastName} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (optional)">
          <Input name="email" type="email" maxLength={200} defaultValue={person.email ?? ""} />
        </Field>
        <Field label="Phone (optional)">
          <Input name="phone" type="tel" maxLength={40} defaultValue={person.phone ?? ""} />
        </Field>
      </div>
      <Checkbox name="isMinor" label="Under 18" defaultChecked={person.isMinor} />
      <SubmitButton variant="secondary" className="w-full sm:w-auto">
        Save details
      </SubmitButton>
    </ActionForm>
  );
}

export function GuardianForm({ action, candidates }: { action: FormAction; candidates: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<"existing" | "new">("new");
  return (
    <ActionForm action={action} resetOnSuccess>
      {candidates.length ? (
        <Segmented
          name="mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "new", label: "New guardian" },
            { value: "existing", label: "Existing person" },
          ]}
        />
      ) : (
        <input type="hidden" name="mode" value="new" />
      )}
      {mode === "existing" && candidates.length ? (
        <Field label="Person" hint="e.g. a parent already on file for a sibling">
          <Select name="guardianId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input name="firstName" required maxLength={80} />
            </Field>
            <Field label="Last name (optional)">
              <Input name="lastName" maxLength={80} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email (optional)">
              <Input name="email" type="email" maxLength={200} />
            </Field>
            <Field label="Phone (optional)">
              <Input name="phone" type="tel" maxLength={40} />
            </Field>
          </div>
        </>
      )}
      <Field label="Relationship">
        <Select name="relationship" defaultValue="Parent">
          {["Parent", "Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="secondary" className="w-full sm:w-auto">
        Add guardian
      </SubmitButton>
    </ActionForm>
  );
}

/** Generate an invite link for a person record. */
export function InviteForm({ action, email, label }: { action: FormAction; email: string | null; label: string }) {
  return (
    <ActionForm action={action}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Sign-in email" className="flex-1">
          <Input name="email" type="email" required defaultValue={email ?? ""} maxLength={200} />
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Creating link…">
          {label}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

