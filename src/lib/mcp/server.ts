import "server-only";
import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { SIGNUP_STATUSES, listAuditions, listSignups, setSignupStatus } from "./auditions";
import { importInput, importProduction } from "./import";
import type { McpAuth } from "./keys";
import { assignRoles, assignmentInput, listPeople, personInput, unassignRole, upsertPeople } from "./people";
import {
  createProduction,
  deleteRole,
  getProductionDetail,
  groupInput,
  listProductions,
  productionFields,
  roleInput,
  sceneInput,
  setSceneRoles,
  updateProduction,
  upsertGroups,
  upsertRoles,
  upsertScenes,
} from "./production";
import {
  blockInput,
  callSheet,
  cancelEvent,
  createEvent,
  deleteEvent,
  eventKinds,
  listConflicts,
  listEvents,
  personSchedule,
  publishEvents,
  updateEvent,
} from "./schedule";
import { db } from "@/db";
import { ToolError, getProduction } from "./util";

export const SERVER_INSTRUCTIONS = `Calltime schedules theater rehearsals BY SCENE so every actor (and their parents) automatically knows when they're called.

Data model: organization → productions → roles (characters), role groups, scenes (each scene lists the roles in it), cast (people assigned to roles), events (rehearsals/performances) made of timed blocks. A block calls scenes, roles, groups, individual people, or the whole cast.

Call times are DERIVED, never entered per person: a person's call for an event is the start of the earliest block that calls them and their release is the end of the latest one. Calling a scene calls everyone cast (primary or swing) in any role in that scene; calling a role also calls its understudies. So build the breakdown (roles → scenes with roles → cast) before scheduling.

Typical flow from a script + cast list: call how_to_import_a_script, then import_production once with everything, then get_production to check, then create_event for rehearsals (drafts), get_call_sheet to verify, publish_events when the director approves. Events are drafts (invisible to cast) until published. All times are in the organization's timezone unless an explicit offset is given.`;

const GUIDE = `# Importing a script and cast list into Calltime

1. Read the script's character list → \`roles\`. One role per character. Ensembles are ONE role each ("Pirates", "Daughters", "Townspeople") — individual chorus members are all assigned to that role. Set kind: lead / supporting / featured / ensemble. Use program order.
2. Groups (\`groups\`): bundles you'll call together, e.g. "Pirate Band" = Pirate King + Samuel + Pirates; "Daughters" = Mabel + Edith + Kate + Isabel + Daughters. Optional but handy for music/dance calls.
3. Scenes (\`scenes\`): walk the script in order. For each scene give act, number (text: "1", "3A", "Prologue"), name, songs, pages, and \`roles\` = every role on stage in that scene (including ensembles). This breakdown is what makes scene-based scheduling work — be thorough; when unsure whether a character appears, include them.
4. Cast (\`cast\`): each person with name, email if known, isMinor for kids, guardians [{name, email, phone, relationship}] for minors, and roles. Understudies/swings: roles: [{role: "Mabel", kind: "understudy"}].
5. Send it all in ONE import_production call. It's idempotent: re-run it with corrections and it updates in place (matching production by title, roles by name, scenes by act+number, people by email then full name). It never deletes; use delete_role / unassign_role for removals.
6. Verify with get_production. Then schedule with create_event: blocks like {start: "2026-10-07T18:00", end: "2026-10-07T19:30", title: "Block Act 1", leader: "Director", calls: [{type: "scene", ref: "Act 1 Sc 2"}, {type: "scene", ref: "Act 1 Sc 3"}]}. Each person's call time is computed automatically. Check get_call_sheet, look at list_conflicts, then publish_events.

Tips: don't invent emails, but DO include real ones when you have them — people are matched by email first. Without an email, a person is matched by exact full name, and never to someone who already has a login account (to avoid linking a stranger to a child's schedule); two different people with the same name and no email can't be told apart, so add an email or a distinguishing detail to the name. Names must match exactly between scenes/groups/cast and roles (case-insensitive). Unknown role names referenced in scenes/groups/cast are auto-created by import_production (reported in roles.autoCreatedFromReferences) — check that list for typos.`;

type Handler<S extends z.ZodType> = (args: z.infer<S>, auth: McpAuth) => Promise<unknown>;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function registerCalltimeTools(server: McpServer) {
  const tool = <S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    run: Handler<S>,
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean },
  ) => {
    // Generic zod objects don't narrow to the SDK's overloads; the schema is still validated by the SDK.
    const schema = inputSchema as unknown as StandardSchemaWithJSON;
    server.registerTool(name, { description, inputSchema: schema, annotations }, async (args: unknown, ctx) => {
      const auth = ctx.http?.authInfo?.extra?.calltime as McpAuth | undefined;
      if (!auth) return { isError: true, content: [{ type: "text" as const, text: "Not authenticated." }] };
      try {
        return json(await run(args as z.infer<S>, auth));
      } catch (e) {
        if (e instanceof ToolError) return { isError: true, content: [{ type: "text" as const, text: e.message }] };
        console.error(`[mcp] ${name} failed`, e);
        return { isError: true, content: [{ type: "text" as const, text: `Internal error in ${name}. Tools that write several rows run in a transaction, so nothing from this call was saved.` }] };
      }
    });
  };
  const RO = { readOnlyHint: true };
  const production = z.string().describe("Production id or exact title");

  /* Guidance */
  tool("how_to_import_a_script", "Step-by-step guidance for turning a script and cast list into a Calltime production. Read this first when setting up a show.", z.object({}), async () => ({ guide: GUIDE }), RO);

  /* Productions */
  tool("list_productions", "List the organization's productions with ids, status, key dates and counts. Also returns the org timezone.", z.object({}), (_a, c) => listProductions(c), RO);
  tool(
    "get_production",
    "Full breakdown of one production: roles with who plays them, role groups, scenes (in order) with the roles in each, creative team, and counts. Use it to verify an import or before scheduling.",
    z.object({ production }),
    (a, c) => getProductionDetail(c, a.production),
    RO,
  );
  tool("create_production", "Create a new production (show). Prefer import_production when you also have roles/scenes/cast.", productionFields, async (a, c) => {
    const p = await createProduction(c, a);
    return { id: p.id, title: p.title, status: p.status };
  });
  tool(
    "update_production",
    "Update production fields (only the ones given). status moves through planning → auditions → rehearsals → performances → closed.",
    productionFields.partial().extend({ production }),
    async ({ production: ref, ...f }, c) => {
      const p = await updateProduction(c, ref, f);
      return { id: p.id, title: p.title, status: p.status, updated: Object.keys(f) };
    },
  );

  /* Roles, groups, scenes */
  tool(
    "upsert_roles",
    "Create or update roles (characters) in bulk, matched by name (case-insensitive). Use newName to rename. Ensembles are a single role (e.g. \"Pirates\") that many people are assigned to.",
    z.object({ production, roles: z.array(roleInput).min(1) }),
    async (a, c) => {
      const p = await getProduction(c, a.production);
      const r = await db.transaction((tx) => upsertRoles(p.id, a.roles, tx));
      return { created: r.created, updated: r.updated, unchanged: r.unchanged, totalRoles: r.roles.length };
    },
    { idempotentHint: true },
  );
  tool(
    "delete_role",
    "Delete a role. Also removes it from scenes and groups and unassigns everyone who played it.",
    z.object({ production, role: z.string().describe("Role name or id") }),
    (a, c) => deleteRole(c, a.production, a.role),
    { destructiveHint: true },
  );
  tool(
    "upsert_role_groups",
    "Create or update role groups (named bundles of roles called together, e.g. \"Pirates\" or \"Dance Ensemble\"), matched by name. Each group's role list is replaced with the one given. Roles must already exist.",
    z.object({ production, groups: z.array(groupInput).min(1) }),
    async (a, c) => {
      const p = await getProduction(c, a.production);
      return { groups: await db.transaction((tx) => upsertGroups(p.id, a.groups, tx)) };
    },
    { idempotentHint: true },
  );
  tool(
    "upsert_scenes",
    "Create or update scenes in bulk, matched by act + number (then name). `roles` (names) REPLACES the scene's role list when given — this breakdown determines who gets called when a rehearsal block calls the scene. Roles must already exist (use upsert_roles, or import_production which creates them).",
    z.object({ production, scenes: z.array(sceneInput).min(1) }),
    async (a, c) => {
      const p = await getProduction(c, a.production);
      return { scenes: await db.transaction((tx) => upsertScenes(p.id, a.scenes, tx)) };
    },
    { idempotentHint: true },
  );
  tool(
    "set_scene_roles",
    "Change which roles appear in one scene. mode: replace (default), add, or remove.",
    z.object({
      production,
      scene: z.string().describe("Scene id, name, or \"Act 1 Sc 3\""),
      roles: z.array(z.string()).describe("Role names or ids"),
      mode: z.enum(["replace", "add", "remove"]).default("replace"),
    }),
    (a, c) => db.transaction((tx) => setSceneRoles(c, a.production, a.scene, a.roles, a.mode, tx)),
  );

  /* People & casting */
  tool(
    "list_people",
    "List people in the organization (performers and guardians). Filter by production (only its cast, with their roles) and/or a name/email substring.",
    z.object({
      production: production.optional(),
      query: z.string().optional().describe("Substring of name or email"),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    (a, c) => listPeople(c, a),
    RO,
  );
  tool(
    "upsert_people",
    "Create or update people in bulk. Matched by email (case-insensitive), else exact full name, so re-running doesn't duplicate. For minors, set isMinor and list guardians (created/linked as people too); guardians get access to the child's calls when they sign up.",
    z.object({ people: z.array(personInput).min(1) }),
    async (a, c) => ({ people: await db.transaction((tx) => upsertPeople(c, a.people, tx)) }),
    { idempotentHint: true },
  );
  tool(
    "assign_roles",
    "Cast people in roles, in bulk. Person by id, email or exact full name (must already exist — see upsert_people); role by name or id. Re-assigning updates the kind.",
    z.object({ production, assignments: z.array(assignmentInput).min(1) }),
    async (a, c) => {
      const p = await getProduction(c, a.production);
      return { assigned: await db.transaction((tx) => assignRoles(c, p.id, a.assignments, tx)) };
    },
    { idempotentHint: true },
  );
  tool(
    "unassign_role",
    "Remove one person from one role.",
    z.object({ production, person: z.string(), role: z.string() }),
    (a, c) => unassignRole(c, a.production, a.person, a.role),
  );
  tool(
    "import_production",
    "Create or merge a WHOLE production in one call from a structured breakdown: production details, roles, groups, scenes (with the roles in each, by name) and cast (people with optional guardians and their roles). Idempotent — re-running with the same or corrected data updates in place and never duplicates or deletes. Runs in one transaction: on error nothing is saved. Read how_to_import_a_script for guidance.",
    importInput,
    (a, c) => importProduction(c, a),
    { idempotentHint: true },
  );

  /* Schedule */
  tool(
    "list_events",
    "List a production's events (rehearsals, performances…) with blocks, what each block calls, and how many people are called. Includes drafts by default. Times are org-local.",
    z.object({
      production,
      from: z.string().optional().describe("Start of range (date or date-time, org-local). Default: no limit"),
      to: z.string().optional(),
      includeDrafts: z.boolean().default(true),
      status: z.enum(["draft", "published", "cancelled"]).optional(),
    }),
    (a, c) => listEvents(c, a),
    RO,
  );
  tool(
    "create_event",
    "Schedule an event (rehearsal, performance, tech, …) made of timed blocks. Each block calls scenes/roles/groups/people/all_cast; every person's call time is computed from the blocks (earliest start → latest end of the blocks that call them). Event start/end default to the span of the blocks; location defaults to the production's default location. Created as a DRAFT (invisible to cast) unless publish is true.",
    z.object({
      production,
      title: z.string().min(1).describe("e.g. \"Rehearsal\", \"Act 1 blocking\", \"Opening night\""),
      kind: z.enum(eventKinds).default("rehearsal"),
      start: z.string().optional().describe("Org-local \"YYYY-MM-DDTHH:mm\" or ISO with offset. Defaults to first block start"),
      end: z.string().optional(),
      location: z.string().nullish(),
      notes: z.string().nullish().describe("Shown to everyone called"),
      publish: z.boolean().default(false),
      blocks: z.array(blockInput).min(1),
    }),
    (a, c) => createEvent(c, a),
  );
  tool(
    "update_event",
    "Edit an event. Only given fields change; `blocks`, when given, REPLACES all blocks. For published events a material change (time, location, kind, blocks) bumps the revision so families' calendars update and see an \"Updated\" badge.",
    z.object({
      event: z.string().describe("Event id"),
      title: z.string().optional(),
      kind: z.enum(eventKinds).optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      location: z.string().nullish(),
      notes: z.string().nullish(),
      blocks: z.array(blockInput).min(1).optional(),
    }),
    (a, c) => updateEvent(c, a),
  );
  tool(
    "publish_events",
    "Publish draft events so the cast and guardians see their calls (and calendar feeds update). Pass event ids, or a production to publish all its drafts (optionally only those starting within from/to). Publishing a cancelled event reinstates it.",
    z.object({
      events: z.array(z.string()).optional().describe("Event ids"),
      production: production.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    (a, c) => db.transaction((tx) => publishEvents(c, a, tx)),
  );
  tool(
    "cancel_event",
    "Cancel an event. Cast still see it, marked cancelled (and calendars show it cancelled). Prefer this over delete_event for anything already published.",
    z.object({ event: z.string(), reason: z.string().optional().describe("Shown to families") }),
    (a, c) => cancelEvent(c, a.event, a.reason),
  );
  tool(
    "delete_event",
    "Permanently delete an event (use for drafts or mistakes; use cancel_event for published events people may have planned around).",
    z.object({ event: z.string() }),
    (a, c) => deleteEvent(c, a.event),
    { destructiveHint: true },
  );
  tool(
    "get_call_sheet",
    "Who is called to an event and when: each person's call and release time and what they're rehearsing, plus the block schedule. Works for drafts too — use it to check a schedule before publishing.",
    z.object({ event: z.string() }),
    (a, c) => callSheet(c, a.event),
    RO,
  );
  tool(
    "get_person_schedule",
    "One person's upcoming calls across productions (published + cancelled; drafts optional).",
    z.object({
      person: z.string().describe("Person id, email or exact full name"),
      from: z.string().optional().describe("Default: now"),
      to: z.string().optional(),
      includeDrafts: z.boolean().default(false),
    }),
    (a, c) => personSchedule(c, a),
    RO,
  );
  tool(
    "list_conflicts",
    "Cast members' reported unavailability for a production, each with the scheduled calls (drafts included) it collides with. Check before publishing.",
    z.object({ production, from: z.string().optional().describe("Default: now"), to: z.string().optional() }),
    (a, c) => listConflicts(c, a),
    RO,
  );

  /* Auditions */
  tool(
    "list_auditions",
    "Auditions (optionally for one production) with slots, public signup path and signup counts by status.",
    z.object({ production: production.optional() }),
    (a, c) => listAuditions(c, a.production),
    RO,
  );
  tool(
    "list_audition_signups",
    "Signups for one audition with contact info, interests, ratings and status.",
    z.object({ audition: z.string().describe("Audition id"), status: z.enum(SIGNUP_STATUSES).optional() }),
    (a, c) => listSignups(c, a.audition, a.status),
    RO,
  );
  tool(
    "set_signup_status",
    "Move audition signups through registered → checked_in → auditioned → callback → cast | not_cast | withdrawn. Optionally set a 1–5 rating and staff notes. Setting \"cast\" does not create cast assignments by itself.",
    z.object({
      signups: z.array(z.string()).min(1).describe("Signup ids"),
      status: z.enum(SIGNUP_STATUSES),
      rating: z.number().int().min(1).max(5).optional(),
      staffNotes: z.string().optional(),
    }),
    (a, c) => setSignupStatus(c, a),
  );
}
