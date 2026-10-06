"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button, Field, Input, Notice } from "@/components/ui";
import { type CreateKeyState, createKeyAction } from "./actions";
import { Snippet, connectSnippets } from "./snippets";

export function CreateKeyForm({ orgId, mcpUrl }: { orgId: string; mcpUrl: string }) {
  const [state, formAction, pending] = useActionState<CreateKeyState, FormData>(createKeyAction, {});
  if (state.key) {
    const s = connectSnippets(mcpUrl, state.key);
    return (
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-gold/40 bg-gold-soft p-3">
          <p className="text-sm font-semibold text-ink">“{state.name}” is ready. Copy it now — it won’t be shown again.</p>
          <p className="break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">{state.key}</p>
          <CopyButton value={state.key} label="Copy key" />
        </div>
        <Snippet title="Claude Code" hint="Run in a terminal." code={s.cli} />
        <Snippet title="Claude Desktop" hint="Settings → Developer → Edit Config, merge this in, then restart Claude." code={s.desktop} />
        <Snippet title=".mcp.json (Claude Code, per project)" code={s.mcpJson} />
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <input type="hidden" name="orgId" value={orgId} />
      <Field label="Key name" hint="Who or what will use it, so you can recognize and revoke it later.">
        <Input name="name" required maxLength={80} placeholder="Claude — Jordan’s laptop" autoComplete="off" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        <KeyRound className="size-4" />
        {pending ? "Creating…" : "Create key"}
      </Button>
    </form>
  );
}
