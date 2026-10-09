import { CopyButton } from "@/components/copy-button";

/** Copyable setup snippets for connecting an MCP client. Safe in server and client components. */
export function connectSnippets(mcpUrl: string, key: string) {
  const cli = `claude mcp add --transport http calltime ${mcpUrl} --header "Authorization: Bearer ${key}"`;
  // Claude Desktop's config file only launches local (stdio) servers, so bridge with mcp-remote.
  // The header value sits in env (no spaces in args) per mcp-remote's README.
  const desktop = JSON.stringify(
    {
      mcpServers: {
        calltime: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${CALLTIME_AUTH}"],
          env: { CALLTIME_AUTH: `Bearer ${key}` },
        },
      },
    },
    null,
    2,
  );
  const mcpJson = JSON.stringify(
    { mcpServers: { calltime: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );
  return { cli, desktop, mcpJson };
}

export function Snippet({ title, hint, code, copyLabel = "Copy" }: { title: string; hint?: string; code: string; copyLabel?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <CopyButton value={code} label={copyLabel} />
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <pre className="overflow-x-auto rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
