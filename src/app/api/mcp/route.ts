import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { type McpAuth, verifyApiKey } from "@/lib/mcp/keys";
import { SERVER_INSTRUCTIONS, registerCalltimeTools } from "@/lib/mcp/server";

/**
 * MCP endpoint (Streamable HTTP, stateless): POST /api/mcp
 * Auth: `Authorization: Bearer ct_…` — an org API key created at /org/api-keys.
 */
const handler = createMcpHandler(registerCalltimeTools, {
  serverInfo: { name: "calltime", version: "0.1.0" },
  instructions: SERVER_INSTRUCTIONS,
});

/** Key verified by `route` for this request, so `withMcpAuth` doesn't look it up a second time. */
const verified = new WeakMap<Request, McpAuth>();

const authed = withMcpAuth(
  handler,
  async (req, token) => {
    const auth = verified.get(req) ?? (await verifyApiKey(token));
    if (!auth) return undefined;
    return { token: auth.keyId, clientId: auth.keyId, scopes: ["calltime"], extra: { calltime: auth } };
  },
  { required: true },
);

/**
 * `withMcpAuth` answers every rejection with "No authorization provided", which sends people with a
 * revoked or mistyped key looking for a missing header. Verify first and, when a bearer token was
 * sent but doesn't resolve, send the same RFC 6750 challenge with a message that says so; a request
 * with no credentials falls through to the library's own response.
 */
async function route(req: Request) {
  const [type, token] = req.headers.get("authorization")?.split(" ") ?? [];
  if (type?.toLowerCase() === "bearer" && token) {
    const auth = await verifyApiKey(token);
    if (!auth) return invalidKey(req);
    verified.set(req, auth);
  }
  return authed(req);
}

function invalidKey(req: Request) {
  const description = "Invalid or revoked API key. Create a new one at /org/api-keys.";
  const metadata = `${getPublicOrigin(req)}/.well-known/oauth-protected-resource`;
  return Response.json(
    { error: "invalid_token", error_description: description },
    {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${metadata}"` },
    },
  );
}

export { route as GET, route as POST, route as DELETE };
export const maxDuration = 60;
