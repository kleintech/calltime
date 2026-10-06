import "server-only";
import { and, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productions } from "@/db/schema";
import { assignRoles, personInput, upsertPeople } from "./people";
import {
  createProduction,
  groupInput,
  matchRoles,
  productionFields,
  roleInput,
  sceneInput,
  upsertGroups,
  upsertRoles,
  upsertScenes,
} from "./production";
import { withCallImpact } from "@/lib/changes";
import { type Ctx, fail, getProduction, isUuid, loadOrgPeople } from "./util";

const castRole = z.union([
  z.string().describe("Role name"),
  z.object({
    role: z.string(),
    kind: z.enum(["primary", "understudy", "swing"]).default("primary"),
  }),
]);

export const importInput = z.object({
  production: productionFields
    .extend({
      id: z.string().optional().describe("Existing production id to merge into. Otherwise matched by exact title, or created."),
    })
    .describe("The show. Matched by id, then by exact title within the organization; created if absent."),
  roles: z.array(roleInput).default([]).describe("Every character/part, in program order. Ensembles are one role each (\"Pirates\")."),
  groups: z.array(groupInput).default([]).describe("Named bundles of roles you'll want to call together"),
  scenes: z.array(sceneInput).default([]).describe("Scene breakdown in running order; `roles` lists who appears in each"),
  cast: z
    .array(
      personInput.extend({
        roles: z.array(castRole).default([]).describe("Roles this person plays: names, or {role, kind} for understudies/swings"),
      }),
    )
    .default([])
    .describe("Cast list. People are matched by email, then exact full name, so re-imports update rather than duplicate."),
});
export type ImportInput = z.infer<typeof importInput>;

/**
 * Create or merge a whole production breakdown in one transaction. Idempotent: re-running with
 * the same input changes nothing; re-running with edits applies just the edits. Never deletes
 * roles, scenes or people that are missing from the input.
 */
export async function importProduction(ctx: Ctx, input: ImportInput) {
  return db.transaction(async (tx) => {
    /* Production */
    const { id: prodId, ...fields } = input.production;
    let production;
    let productionCreated = false;
    if (prodId) {
      if (!isUuid(prodId)) fail("production.id must be a production id (UUID).");
      production = await getProduction(ctx, prodId, tx);
    } else {
      const matches = await tx
        .select()
        .from(productions)
        .where(and(eq(productions.orgId, ctx.orgId), ilike(productions.title, fields.title.trim().replace(/[%_\\]/g, "\\$&"))));
      if (matches.length > 1) fail(`Several productions are titled "${fields.title}"; pass production.id.`);
      production = matches[0];
    }
    if (!production) {
      production = await createProduction(ctx, fields, tx);
      productionCreated = true;
    } else {
      const set: Partial<typeof productions.$inferInsert> = {};
      for (const k of ["title", "subtitle", "description", "venue", "defaultLocation", "status", "firstRehearsal", "openingDate", "closingDate", "accentColor"] as const) {
        if (fields[k] !== undefined && fields[k] !== production[k]) (set as Record<string, unknown>)[k] = fields[k] ?? null;
      }
      if (Object.keys(set).length) [production] = await tx.update(productions).set(set).where(eq(productions.id, production.id)).returning();
    }
    const pid = production.id;

    // Everything below can change who's called at published events: record that per person.
    const { result: r, changes } = await withCallImpact(tx, pid, ctx.userId, async (tx) => {
      /* Roles: declared ones, plus any referenced by groups/scenes/cast but not declared. */
      const declared = new Set(input.roles.map((r) => r.name.trim().toLowerCase()));
      const referenced = [
        ...input.groups.flatMap((g) => g.roles),
        ...input.scenes.flatMap((s) => s.roles ?? []),
        ...input.cast.flatMap((c) => c.roles.map((r) => (typeof r === "string" ? r : r.role))),
      ];
      const existingNow = await upsertRoles(pid, input.roles, tx);
      const implicit = [...new Set(referenced.map((r) => r.trim()))].filter(
        (r) => r && !isUuid(r) && !declared.has(r.toLowerCase()) && matchRoles(existingNow.roles, [r]).missing.length > 0,
      );
      const roleResult = implicit.length
        ? await upsertRoles(pid, implicit.map((name) => ({ name })), tx)
        : existingNow;
      const allRoles = roleResult.roles;

      /* Groups and scenes */
      const groups = await upsertGroups(pid, input.groups, tx, allRoles);
      const scenes = await upsertScenes(pid, input.scenes, tx, allRoles);

      /* Cast */
      const pool = await loadOrgPeople(ctx, tx);
      const people = await upsertPeople(ctx, input.cast, tx, pool);
      const assignments = input.cast.flatMap((c, i) =>
        c.roles.map((r) => ({
          person: people[i].id,
          role: typeof r === "string" ? r : r.role,
          kind: typeof r === "string" ? ("primary" as const) : r.kind,
        })),
      );
      const assigned = await assignRoles(ctx, pid, assignments, tx, pool, allRoles);
      return { existingNow, implicit, roleResult, allRoles, groups, scenes, people, assigned };
    });
    const { existingNow, implicit, roleResult, allRoles, groups, scenes, people, assigned } = r;
    return {
      production: { id: pid, title: production.title, created: productionCreated },
      roles: {
        total: allRoles.length,
        created: [...existingNow.created, ...(implicit.length ? roleResult.created : [])],
        autoCreatedFromReferences: implicit,
        updated: existingNow.updated,
      },
      groups: { total: groups.length, created: groups.filter((g) => g.created).map((g) => g.name) },
      scenes: { total: scenes.length, created: scenes.filter((s) => s.created).map((s) => s.label) },
      people: {
        total: people.length,
        created: people.filter((p) => p.created).map((p) => p.name),
        guardiansCreated: people.flatMap((p) => p.guardians?.filter((g) => g.created).map((g) => g.name) ?? []),
      },
      assignments: assigned.length,
      publishedEventsAffected: changes.length,
      next: "Use get_production to review, then create_event to schedule rehearsals by scene.",
      changes,
    };
  });
}
