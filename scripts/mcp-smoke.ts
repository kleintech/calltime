/**
 * End-to-end smoke test for the MCP endpoint against a running dev server.
 *
 *   npx tsx --env-file=.env.local scripts/mcp-smoke.ts [baseUrl]
 *
 * Creates a throwaway API key for an org admin, connects with the official SDK client over
 * Streamable HTTP, imports a small fictional show, schedules + publishes a rehearsal calling a
 * scene, checks the call sheet, re-imports to prove idempotency, then deletes everything it made
 * (production, test people, key). Bugs it would catch: auth not wired / revoked keys accepted,
 * import duplicating rows on re-run, scene calls not resolving to cast (call engine wiring),
 * understudies wrongly called for scene calls, local times interpreted in the server's timezone.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, like, or } from "drizzle-orm";
import { db } from "../src/db";
import { apiKeys, orgMembers, people, productions } from "../src/db/schema";

const BASE = process.argv[2] ?? "http://localhost:3100";
// Per-run tag so concurrent runs never see (or clean up) each other's data.
const TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TITLE = `MCP Test — The Lighthouse Keepers ${TAG}`;
const EMAIL_DOMAIN = `${TAG}.mcp-test.example`;
const WREN = `Wren Testwell${TAG}`;
const OLLIE = `Ollie Testwell${TAG}`;
const JUNO = `Juno Testghost${TAG}`;
const PAT = `Pat Testguardian${TAG}`;

type Json = Record<string, unknown> & { [k: string]: unknown };

async function main() {
  const admin = await db.query.orgMembers.findFirst({ where: eq(orgMembers.role, "admin") });
  if (!admin) throw new Error("No org admin found; seed the database first.");
  // Same format as src/lib/mcp/keys.ts (not imported: it pulls in next/navigation via lib/auth).
  const key = `ct_${randomBytes(24).toString("base64url")}`;
  const [keyRow] = await db
    .insert(apiKeys)
    .values({
      orgId: admin.orgId,
      userId: admin.userId,
      name: "mcp-smoke (temporary)",
      prefix: key.slice(0, 7),
      hash: createHash("sha256").update(key).digest("hex"),
    })
    .returning();

  const connect = async (token: string) => {
    const client = new Client({ name: "calltime-smoke", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
  };

  try {
    /* Auth: a bogus key is rejected */
    await assert.rejects(connect("ct_definitely-not-a-key"), "bogus key must be rejected");
    console.log("ok - bogus key rejected");

    const client = await connect(key);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
      const text = res.content.map((c) => c.text).join("\n");
      if (res.isError) throw new Error(`${name} → ${text}`);
      return JSON.parse(text) as Json;
    };

    const { tools } = await client.listTools();
    console.log(`ok - ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    for (const t of ["import_production", "create_event", "get_call_sheet", "publish_events"]) {
      assert.ok(tools.some((x) => x.name === t), `missing tool ${t}`);
    }

    const breakdown = {
      production: { title: TITLE, subtitle: "Smoke test", status: "rehearsals", defaultLocation: "Studio A" },
      roles: [
        { name: "Keeper", kind: "lead" },
        { name: "Ghost", kind: "supporting" },
        { name: "Gulls", kind: "ensemble" },
      ],
      groups: [{ name: "Birds", roles: ["Gulls"] }],
      scenes: [
        { act: 1, number: "1", name: "The Lamp Room", roles: ["Keeper", "Ghost"] },
        { act: 1, number: "2", name: "The Rocks", roles: ["Keeper", "Gulls"], songs: "Gull Shanty" },
      ],
      cast: [
        { name: WREN, email: `wren@${EMAIL_DOMAIN}`, roles: ["Keeper"] },
        {
          name: OLLIE,
          isMinor: true,
          guardians: [{ name: PAT, email: `pat@${EMAIL_DOMAIN}`, relationship: "Mother" }],
          roles: ["Gulls", { role: "Keeper", kind: "understudy" }],
        },
        { name: JUNO, email: `juno@${EMAIL_DOMAIN}`, roles: ["Ghost"] },
      ],
    };

    const first = await call("import_production", breakdown);
    const prodId = (first.production as Json).id as string;
    assert.equal((first.production as Json).created, true);
    assert.equal((first.roles as Json).total, 3);
    console.log("ok - import_production created", JSON.stringify(first));

    /* Schedule: 18:00–19:00 local calls scene 1 (Keeper + Ghost), 19:00–20:00 calls scene 2. */
    const day = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const ev = await call("create_event", {
      production: TITLE,
      title: "Smoke rehearsal",
      blocks: [
        { start: `${day}T18:00`, end: `${day}T19:00`, title: "Lamp room", calls: [{ type: "scene", ref: "Act 1 Sc 1" }] },
        { start: `${day}T19:00`, end: `${day}T20:00`, calls: [{ type: "scene", ref: "The Rocks" }] },
      ],
    });
    assert.equal(ev.status, "draft");
    assert.equal(ev.start, `${day}T18:00`, "local time must round-trip in the org timezone");
    console.log("ok - create_event (draft)", ev.id);

    const pub = await call("publish_events", { events: [ev.id] });
    assert.equal((pub.published as unknown[]).length, 1);
    console.log("ok - publish_events");

    const sheet = await call("get_call_sheet", { event: ev.id });
    const byName = new Map((sheet.people as Json[]).map((p) => [p.name as string, p]));
    assert.equal(byName.get(WREN)?.call, `${day}T18:00`);
    assert.equal(byName.get(WREN)?.release, `${day}T20:00`);
    assert.equal(byName.get(JUNO)?.release, `${day}T19:00`);
    // Ollie is a Gull (scene 2) and Keeper *understudy* — scene calls skip understudies.
    assert.equal(byName.get(OLLIE)?.call, `${day}T19:00`);
    assert.equal(byName.size, 3);
    console.log("ok - get_call_sheet", JSON.stringify(sheet.people));

    /* Idempotency */
    const detail1 = await call("get_production", { production: prodId });
    const second = await call("import_production", breakdown);
    assert.equal((second.production as Json).id, prodId);
    assert.equal((second.production as Json).created, false);
    assert.deepEqual((second.roles as Json).created, []);
    assert.deepEqual((second.scenes as Json).created, []);
    assert.deepEqual((second.people as Json).created, []);
    assert.deepEqual((second.people as Json).guardiansCreated, []);
    const detail2 = await call("get_production", { production: prodId });
    assert.deepEqual(detail2.counts, detail1.counts, "re-import must not change counts");
    assert.deepEqual(detail2.roles, detail1.roles, "re-import must not change roles/cast");
    console.log("ok - import_production is idempotent");

    /* Editing a published event bumps its revision; cancel/delete work; other tools respond. */
    const upd = await call("update_event", {
      event: ev.id,
      blocks: [{ start: `${day}T18:30`, end: `${day}T20:00`, calls: [{ type: "group", ref: "Birds" }, { type: "role", ref: "Keeper" }] }],
    });
    assert.equal(upd.revisionBumped, true, JSON.stringify(upd));
    assert.equal((upd.event as Json).start, `${day}T18:30`);
    const sheet2 = await call("get_call_sheet", { event: ev.id });
    // A role call includes understudies: Ollie (Keeper understudy + Gull) is now called 18:30.
    assert.equal((sheet2.people as Json[]).find((p) => p.name === OLLIE)?.call, `${day}T18:30`);
    console.log("ok - update_event bumps revision; role call includes understudy");

    const sched = await call("get_person_schedule", { person: `wren@${EMAIL_DOMAIN}` });
    assert.equal((sched.calls as Json[]).length, 1, JSON.stringify(sched));
    const listed = await call("list_events", { production: prodId });
    assert.equal((listed.events as Json[]).length, 1);
    await call("list_conflicts", { production: prodId });
    const ppl = await call("list_people", { production: prodId });
    assert.equal(ppl.total, 3);
    assert.equal(((ppl.people as Json[]).find((p) => p.name === OLLIE)?.guardians as Json[])[0].name, PAT);
    await call("set_scene_roles", { production: prodId, scene: "1-2", roles: ["Ghost"], mode: "add" });
    await call("upsert_roles", { production: prodId, roles: [{ name: "Ghost", description: "Spectral" }] });
    const un = await call("unassign_role", { production: prodId, person: JUNO, role: "Ghost" });
    assert.equal(un.removed, true);
    const cancelled = await call("cancel_event", { event: ev.id, reason: "Smoke" });
    assert.equal(cancelled.status, "cancelled");
    const ev2 = await call("create_event", {
      production: prodId,
      title: "Draft to delete",
      blocks: [{ start: `${day}T10:00`, end: `${day}T11:00`, calls: [{ type: "all_cast" }] }],
    });
    await call("delete_event", { event: ev2.id });
    const auds = await call("list_auditions", {});
    const firstAud = (auds.auditions as Json[])[0];
    if (firstAud) await call("list_audition_signups", { audition: firstAud.id as string });
    await call("list_productions");
    await call("how_to_import_a_script");
    console.log("ok - remaining tools respond");

    /* Regressions from review round 1 */
    const isErr = async (name: string, args: Record<string, unknown>) =>
      ((await client.callTool({ name, arguments: args })) as { isError?: boolean }).isError === true;
    // Re-running a rename must not create a duplicate role.
    const renameOnce = { production: { title: TITLE }, roles: [{ name: "Ghost", newName: "Phantom" }] };
    await call("import_production", renameOnce);
    const rerun = await call("import_production", renameOnce);
    assert.deepEqual((rerun.roles as Json).created, [], "rename re-run created a duplicate role");
    // Impossible / DST-skipped local times are rejected instead of rolling over.
    for (const bad of ["2026-02-30T18:00", "2026-10-07T25:00", "2026-03-08T02:30"]) {
      assert.ok(
        await isErr("create_event", { production: prodId, title: "Bad", blocks: [{ start: bad, end: "2026-12-01T10:00", calls: [{ type: "all_cast" }] }] }),
        `accepted impossible time ${bad}`,
      );
    }
    // "Act 1 Sc 1-2" is not silently read as scene 1; "Act 12" is not act 1 scene 2.
    for (const ref of ["Act 1 Sc 1-2", "Act 12"]) {
      assert.ok(
        await isErr("create_event", { production: prodId, title: "Bad", blocks: [{ start: `${day}T09:00`, end: `${day}T10:00`, calls: [{ type: "scene", ref }] }] }),
        `scene ref "${ref}" resolved`,
      );
    }
    // Resending identical blocks on a published event doesn't bump the revision.
    const ev3 = await call("create_event", {
      production: prodId,
      title: "Same blocks",
      publish: true,
      blocks: [{ start: `${day}T12:00`, end: `${day}T13:00`, calls: [{ type: "role", ref: "Keeper" }] }],
    });
    const same = await call("update_event", {
      event: ev3.id,
      title: "Same blocks (renamed)",
      blocks: [{ start: `${day}T12:00`, end: `${day}T13:00`, calls: [{ type: "role", ref: "Keeper" }] }],
    });
    assert.equal(same.revisionBumped, false, "identical blocks bumped the revision");
    // Reinstating a cancelled event drops the "Cancelled: …" note.
    await call("cancel_event", { event: ev3.id, reason: "Snow" });
    await call("publish_events", { events: [ev3.id] });
    const back = (await call("list_events", { production: prodId })).events as Json[];
    assert.equal(back.find((e) => e.id === ev3.id)?.notes, undefined, "cancel note survived reinstatement");
    // Name-only person matching refuses to pick between two namesakes.
    await call("upsert_people", { people: [{ name: `Ann Dup${TAG}`, email: `ann1@${EMAIL_DOMAIN}` }, { name: `Ann Dup${TAG}`, email: `ann2@${EMAIL_DOMAIN}` }] });
    assert.ok(await isErr("upsert_people", { people: [{ name: `Ann Dup${TAG}`, phone: "555" }] }), "ambiguous namesake merged");
    console.log("ok - review regressions (rename, bad times, scene refs, no-op blocks, reinstate notes, namesakes)");

    /* Errors are reported, not thrown */
    const bad = (await client.callTool({ name: "get_production", arguments: { production: "No Such Show xyz" } })) as { isError?: boolean };
    assert.equal(bad.isError, true);
    console.log("ok - unknown production → isError");

    await client.close();

    /* Revoked keys stop working */
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyRow.id));
    await assert.rejects(connect(key), "revoked key must be rejected");
    console.log("ok - revoked key rejected");
  } finally {
    const deleted = await db.delete(productions).where(and(eq(productions.orgId, admin.orgId), eq(productions.title, TITLE))).returning();
    const gone = await db
      .delete(people)
      .where(and(eq(people.orgId, admin.orgId), or(like(people.email, `%@${EMAIL_DOMAIN}`), like(people.lastName, `%${TAG}`))))
      .returning();
    await db.delete(apiKeys).where(eq(apiKeys.id, keyRow.id));
    console.log(`cleanup: deleted ${deleted.length} production(s), ${gone.length} test people, 1 key`);
  }
  console.log("\nMCP smoke test passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
