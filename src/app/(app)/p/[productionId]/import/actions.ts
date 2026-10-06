"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProductionEditor } from "@/lib/access";
import { importProduction, type ImportInput } from "@/lib/mcp/import";
import { ToolError } from "@/lib/mcp/util";
import { parseSheet, sameRole, type CastRow, type RoleRow, type SceneRow, type SheetKind } from "./sheet";

export type ImportResult = {
  ok?: boolean;
  error?: string;
  summary?: string[];
  skippedRows?: number;
};

const inputSchema = z.object({
  kind: z.enum(["roles", "scenes", "cast"]),
  text: z.string().max(500_000),
  skipRoles: z.array(z.string().max(200)).max(500).default([]),
});

/**
 * Apply a pasted sheet through the same idempotent merge the MCP import uses: roles by name,
 * scenes by act+number, people by email then full name. Re-importing the same paste changes
 * nothing; nothing missing from the paste is deleted. Rows with errors are skipped.
 */
export async function importSheet(
  productionId: string,
  args: { kind: SheetKind; text: string; skipRoles: string[] },
): Promise<ImportResult> {
  const { user, org, production } = await requireProductionEditor(productionId);
  const parsedArgs = inputSchema.safeParse(args);
  if (!parsedArgs.success) return { error: "That paste is too large or malformed." };
  const { kind, text, skipRoles } = parsedArgs.data;

  const sheet = parseSheet(kind, text);
  const valid = sheet.rows.filter((r) => r.value);
  if (!valid.length) return { error: "Nothing to import: no valid rows found." };
  const keep = (names: string[]) => names.filter((n) => !skipRoles.some((s) => sameRole(s, n)));

  const input: ImportInput = {
    production: { id: productionId, title: production.title },
    roles: [],
    groups: [],
    scenes: [],
    cast: [],
  };
  if (kind === "roles") {
    input.roles = valid.map((r) => {
      const v = r.value as RoleRow;
      return { name: v.name, kind: v.kind, description: v.description };
    });
  } else if (kind === "scenes") {
    input.scenes = valid.map((r) => {
      const v = r.value as SceneRow;
      const roles = keep(v.roles);
      return {
        act: v.act,
        number: v.number,
        name: v.name,
        songs: v.songs,
        pages: v.pages,
        // Only replace a scene's role list when the row actually lists roles.
        roles: roles.length ? roles : undefined,
      };
    });
  } else {
    input.cast = valid.map((r) => {
      const v = r.value as CastRow;
      return {
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        isMinor: v.isMinor,
        guardians: v.guardianName ? [{ name: v.guardianName, email: v.guardianEmail }] : undefined,
        roles: keep(v.roles).map((role) => ({ role, kind: v.kind })),
      };
    });
  }

  try {
    const res = await importProduction(
      { keyId: "web-import", orgId: org.id, orgName: org.name, timezone: org.timezone, userId: user.id, userName: user.name },
      input,
    );
    revalidatePath(`/p/${productionId}`, "layout");
    const n = (xs: unknown[], w: string) => `${xs.length} ${w}${xs.length === 1 ? "" : "s"}`;
    const summary: string[] = [];
    if (res.roles.created.length) summary.push(`${n(res.roles.created, "new role")}: ${res.roles.created.join(", ")}`);
    if (res.roles.updated.length) summary.push(`${n(res.roles.updated, "role")} updated`);
    if (res.scenes.created.length) summary.push(`${n(res.scenes.created, "new scene")}`);
    if (kind === "scenes" && res.scenes.total > res.scenes.created.length)
      summary.push(`${res.scenes.total - res.scenes.created.length} existing scene(s) updated`);
    if (res.people.created.length) summary.push(`${res.people.created.length} new ${res.people.created.length === 1 ? "person" : "people"}: ${res.people.created.join(", ")}`);
    if (res.people.guardiansCreated.length) summary.push(`${n(res.people.guardiansCreated, "new guardian")}`);
    if (kind === "cast") summary.push(`${res.assignments} role assignment(s) in place`);
    if (!summary.length) summary.push("Everything already matched. Nothing changed.");
    return { ok: true, summary, skippedRows: sheet.rows.length - valid.length };
  } catch (e) {
    if (e instanceof ToolError) return { error: e.message };
    throw e;
  }
}
