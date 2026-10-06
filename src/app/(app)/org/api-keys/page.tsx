import { desc, eq } from "drizzle-orm";
import { Bot } from "lucide-react";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, EmptyState, List, PageHeader, SectionTitle } from "@/components/ui";
import { appBaseUrl } from "@/lib/invites";
import { fmtDateTime, fmtDay } from "@/lib/time";
import { SubmitButton } from "../_components/action-form";
import { OrgChrome } from "../_components/org-chrome";
import { resolveAdminOrg } from "../_lib/org";
import { revokeKeyAction } from "./actions";
import { CreateKeyForm } from "./create-key-form";
import { Snippet, connectSnippets } from "./snippets";

export const metadata = { title: "API keys" };

const SAMPLE_PROMPT = `I'm attaching our script and cast list for our new show. Using the Calltime tools:
1. Read how_to_import_a_script.
2. Build the full breakdown — every role (ensembles as one role each), sensible role groups, and every scene in order with the roles that appear in it — plus the cast with their roles, marking minors and adding their parents as guardians.
3. Import it all with one import_production call, then show me a summary from get_production so I can check it.
Don't invent email addresses. Don't schedule anything yet.`;

const SAMPLE_SCHEDULE_PROMPT = `Draft next week's rehearsals for our show: Mon & Wed 6–9pm, Sat 10am–2pm. Block Act 1 in order, about 45 minutes per scene, music with the Music Director at the start of each weekday. Check list_conflicts, show me each day's call sheet, and leave everything as drafts.`;

export default async function ApiKeysPage({ searchParams }: PageProps<"/org/api-keys">) {
  const sp = await searchParams;
  const { org, orgs } = await resolveAdminOrg(sp.org);
  const mcpUrl = `${await appBaseUrl()}/api/mcp`;

  const keys = await db
    .select({ key: apiKeys, userName: users.name })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.orgId, org.id))
    .orderBy(desc(apiKeys.createdAt));
  const active = keys.filter((k) => !k.key.revokedAt);
  const revoked = keys.filter((k) => k.key.revokedAt);
  const placeholder = connectSnippets(mcpUrl, "ct_YOUR_KEY");

  return (
    <div>
      <PageHeader title="API keys" subtitle="Let an AI assistant like Claude set up and schedule productions for you." />
      <OrgChrome org={org} orgs={orgs} active="api-keys" path="/org/api-keys" />

      <Card className="space-y-2">
        <p className="text-sm">
          An API key lets an assistant use Calltime&rsquo;s tools (via MCP) to read a script and cast list and build the whole
          production — roles, scenes, cast, guardians — then draft rehearsals by scene. It can see and change everything in{" "}
          <strong>{org.name}</strong>, acting as the admin who created it.
        </p>
        <p className="text-xs text-muted">Treat a key like a password. Revoke it if it leaks or you stop using it.</p>
      </Card>

      <SectionTitle>Create a key</SectionTitle>
      <Card>
        <CreateKeyForm orgId={org.id} mcpUrl={mcpUrl} />
      </Card>

      <SectionTitle>Active keys</SectionTitle>
      {active.length === 0 ? (
        <EmptyState title="No active keys" body="Create one above to connect Claude." />
      ) : (
        <List>
          {active.map(({ key, userName }) => (
            <div key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{key.name}</div>
                <div className="text-sm text-muted">
                  <span className="font-mono">{key.prefix}…</span> · by {userName} · created {fmtDay(key.createdAt, org.timezone)}
                </div>
                <div className="text-xs text-muted">
                  {key.lastUsedAt ? `Last used ${fmtDateTime(key.lastUsedAt, org.timezone)}` : "Never used"}
                </div>
              </div>
              <form action={revokeKeyAction}>
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="keyId" value={key.id} />
                <SubmitButton
                  variant="danger"
                  pendingLabel="Revoking…"
                  confirm={`Revoke “${key.name}”? Anything using it stops working immediately.`}
                >
                  Revoke key
                </SubmitButton>
              </form>
            </div>
          ))}
        </List>
      )}

      {revoked.length ? (
        <>
          <SectionTitle>Revoked</SectionTitle>
          <List>
            {revoked.map(({ key, userName }) => (
              <div key={key.id} className="flex items-center gap-3 px-4 py-3 opacity-70">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{key.name}</div>
                  <div className="text-sm text-muted">
                    <span className="font-mono">{key.prefix}…</span> · by {userName} · revoked {fmtDay(key.revokedAt!, org.timezone)}
                  </div>
                </div>
                <Badge tone="danger">Revoked</Badge>
              </div>
            ))}
          </List>
        </>
      ) : null}

      <SectionTitle>Connect Claude</SectionTitle>
      <Card className="space-y-5">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-accent" />
          <p className="text-sm">
            Calltime speaks the Model Context Protocol over HTTP. Point your assistant at this URL and send the key as a bearer
            token. Replace <code className="font-mono">ct_YOUR_KEY</code> below with your key (the snippets shown right after
            you create a key already include it).
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">MCP server URL</h3>
          <code className="block break-all rounded-xl bg-surface-2 px-3 py-2 text-xs">{mcpUrl}</code>
          <CopyButton value={mcpUrl} label="Copy URL" />
        </div>
        <Snippet title="Claude Code" hint="Run in a terminal, then start claude and type /mcp to check it's connected." code={placeholder.cli} />
        <Snippet
          title="Claude Desktop"
          hint="Settings → Developer → Edit Config. Merge this into claude_desktop_config.json and restart Claude. Needs Node.js installed."
          code={placeholder.desktop}
        />
        <Snippet title=".mcp.json (Claude Code, shared per project)" hint="Don't commit a real key — use an environment variable." code={placeholder.mcpJson} />
        <Snippet title="Try this prompt" hint="Attach the script (PDF or text) and the cast list." code={SAMPLE_PROMPT} copyLabel="Copy prompt" />
        <Snippet title="Then schedule" code={SAMPLE_SCHEDULE_PROMPT} copyLabel="Copy prompt" />
      </Card>
    </div>
  );
}
