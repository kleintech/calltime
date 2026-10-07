import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, like } from "drizzle-orm";
import { db } from "../src/db";
import { apiKeys, orgMembers, people, productions } from "../src/db/schema";

const TAG = Date.now().toString(36);
const TITLE = `MCP Test — Bench ${TAG}`;
async function main() {
  const admin = (await db.query.orgMembers.findFirst({ where: eq(orgMembers.role, "admin") }))!;
  const key = `ct_${randomBytes(24).toString("base64url")}`;
  const [k] = await db.insert(apiKeys).values({ orgId: admin.orgId, userId: admin.userId, name: "bench", prefix: key.slice(0, 7), hash: createHash("sha256").update(key).digest("hex") }).returning();
  const client = new Client({ name: "bench", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3100/api/mcp"), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
    return JSON.parse(r.content[0].text);
  };
  try {
    const roles = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}` }));
    const scenes = Array.from({ length: 10 }, (_, i) => ({ act: 1, number: String(i + 1), name: `S${i}`, roles: [`R${i}`, `R${(i + 1) % 10}`] }));
    const cast = Array.from({ length: 20 }, (_, i) => ({ name: `P${i} Bench${TAG}`, email: `p${i}@${TAG}.mcp-test.example`, roles: [`R${i % 10}`] }));
    const imp = await call("import_production", { production: { title: TITLE }, roles, groups: [{ name: "G", roles: ["R0", "R1"] }], scenes, cast });
    const pid = imp.production.id;
    const base = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    for (let e = 0; e < 20; e++) {
      const d = new Date(Date.parse(base) + e * 86400_000).toISOString().slice(0, 10);
      await call("create_event", { production: pid, title: "Rehearsal", publish: true, blocks: [0, 1, 2].map((b) => ({ start: `${d}T1${b}:00`, end: `${d}T1${b}:59`, calls: [{ type: "scene", ref: `Act 1 Sc ${((e + b) % 10) + 1}` }] })) });
    }
    const t = async (label: string, fn: () => Promise<unknown>) => {
      const s = performance.now(); const r = await fn(); console.log(`${label}: ${Math.round(performance.now() - s)} ms`, JSON.stringify(r).slice(0, 80));
    };
    for (let i = 0; i < 2; i++) {
      await t("assign_roles", () => call("assign_roles", { production: pid, assignments: [{ person: `p${i}@${TAG}.mcp-test.example`, role: `R${(i + 5) % 10}` }] }));
      await t("set_scene_roles(add)", () => call("set_scene_roles", { production: pid, scene: "Act 1 Sc 3", roles: [`R${7 + i}`], mode: "add" }));
      await t("unassign_role", () => call("unassign_role", { production: pid, person: `p${i}@${TAG}.mcp-test.example`, role: `R${(i + 5) % 10}` }));
      await t("upsert_role_groups", () => call("upsert_role_groups", { production: pid, groups: [{ name: "G", roles: i ? ["R0", "R1"] : ["R0", "R1", "R2"] }] }));
    }
  } finally {
    await db.delete(productions).where(and(eq(productions.orgId, admin.orgId), eq(productions.title, TITLE)));
    await db.delete(people).where(like(people.email, `%@${TAG}.mcp-test.example`));
    await db.delete(apiKeys).where(eq(apiKeys.id, k.id));
    process.exit(0);
  }
}
main();
