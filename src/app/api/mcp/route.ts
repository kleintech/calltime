import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiKey } from "@/lib/mcp/keys";
import { SERVER_INSTRUCTIONS, registerCalltimeTools } from "@/lib/mcp/server";

/**
 * MCP endpoint (Streamable HTTP, stateless): POST /api/mcp
 * Auth: `Authorization: Bearer ct_…` — an org API key created at /org/api-keys.
 */
const handler = createMcpHandler(registerCalltimeTools, {
  serverInfo: { name: "calltime", version: "0.1.0" },
  instructions: SERVER_INSTRUCTIONS,
});

const authed = withMcpAuth(
  handler,
  async (_req, token) => {
    const auth = await verifyApiKey(token);
    if (!auth) return undefined;
    return { token: auth.keyId, clientId: auth.keyId, scopes: ["calltime"], extra: { calltime: auth } };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
export const maxDuration = 60;
