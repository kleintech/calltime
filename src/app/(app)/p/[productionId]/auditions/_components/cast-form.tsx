"use client";

import { useActionState, useEffect } from "react";
import { CopyButton } from "@/components/copy-button";
import { toast } from "@/components/toast";
import { Checkbox, Notice, Select } from "@/components/ui";
import { castAction, generateInvites, type CastState, type InviteLink } from "../actions";
import { SubmitButton } from "./forms";

export function InviteLinks({ invites }: { invites: InviteLink[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {invites.map((i) => (
        <li key={i.url} className="space-y-2 px-3 py-3">
          <div className="text-sm">
            <span className="font-medium">{i.name}</span> <span className="text-muted">· {i.as}</span>
            <div className="truncate text-xs text-muted">{i.email}</div>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-2 text-xs">{i.url}</code>
            <CopyButton value={i.url} label="Copy" share />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Result({ state }: { state: CastState }) {
  useEffect(() => {
    if (state.ok) toast(state.ok, { tone: "success" });
  }, [state]);
  return (
    <>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.invites?.length ? <InviteLinks invites={state.invites} /> : null}
    </>
  );
}

export function CastForm({
  ids,
  roles,
  preselect,
  castLabel,
  personName,
}: {
  ids: { productionId: string; auditionId: string; signupId: string };
  roles: { id: string; name: string; taken: number }[];
  preselect: string[];
  castLabel: string;
  personName: string;
}) {
  const [state, action] = useActionState(castAction, {});
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        // Explicit summary before anything is created.
        const fd = new FormData(e.currentTarget);
        const picked = roles.filter((r) => fd.getAll("roleIds").includes(r.id)).map((r) => r.name);
        if (picked.length === 0) return; // the server explains
        const kind = String(fd.get("kind") ?? "primary");
        const msg = `Cast ${personName} as ${picked.join(", ")}${kind === "primary" ? "" : ` (${kind})`}?${
          fd.get("invite") === "on" ? "\n\nInvite links will be created for them and their guardian." : ""
        }`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
    >
      {Object.entries(ids).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Cast as…</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <label
              key={r.id}
              className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-sm has-[:checked]:border-success has-[:checked]:bg-success-soft has-[:checked]:text-success"
            >
              <input type="checkbox" name="roleIds" value={r.id} defaultChecked={preselect.includes(r.id)} className="sr-only" />
              {r.name}
              {r.taken ? <span className="text-xs opacity-60">·{r.taken}</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select name="kind" defaultValue="primary" aria-label="Casting type" className="sm:w-44">
          <option value="primary">Primary</option>
          <option value="understudy">Understudy</option>
          <option value="swing">Swing</option>
        </Select>
        <Checkbox name="invite" label="Generate invite links" />
      </div>
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Casting…">
        {castLabel}
      </SubmitButton>
      <Result state={state} />
    </form>
  );
}

export function BulkInvites({ ids, signupIds }: { ids: { productionId: string; auditionId: string }; signupIds: string[] }) {
  const [state, action] = useActionState(generateInvites, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="productionId" value={ids.productionId} />
      <input type="hidden" name="auditionId" value={ids.auditionId} />
      {signupIds.map((id) => (
        <input key={id} type="hidden" name="signupIds" value={id} />
      ))}
      <SubmitButton variant="secondary" pendingLabel="Creating links…" disabled={signupIds.length === 0}>
        Generate invite links for everyone cast
      </SubmitButton>
      <Result state={state} />
    </form>
  );
}
