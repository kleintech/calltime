import "server-only";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { people, productions } from "@/db/schema";
import { fromLocalInput, toLocalInput } from "@/lib/time";
import type { McpAuth } from "./keys";

export type Ctx = McpAuth;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Q = typeof db | Tx;

/** An error whose message is safe and useful to show the calling LLM. */
export class ToolError extends Error {}

export const fail = (msg: string): never => {
  throw new ToolError(msg);
};

export const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

/**
 * Parse a time from a tool argument. Accepts ISO 8601 with an offset or Z
 * ("2026-10-07T18:00:00-04:00") or a wall-clock time in the org's timezone
 * ("2026-10-07T18:00" or "2026-10-07 18:00"). A bare date ("2026-10-07") means local midnight.
 */
export function parseTime(value: string, tz: string, field = "time"): Date {
  const v = value.trim();
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) && /\dT\d/.test(v)) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) fail(`${field}: invalid date-time "${value}"`);
    return d;
  }
  const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2})(?::\d{2})?)?$/);
  if (!m) fail(`${field}: expected "YYYY-MM-DDTHH:mm" (org local time) or ISO 8601 with offset, got "${value}"`);
  const [, date, time] = m!;
  const hhmm = (time ?? "00:00").padStart(5, "0");
  const d = fromLocalInput(date, tz, hhmm);
  // Round-trip to reject impossible values (Feb 30, 25:00) that would otherwise roll over, and
  // wall-clock times skipped by a daylight-saving change.
  if (toLocalInput(d, tz) !== `${date}T${hhmm}`)
    fail(`${field}: "${value}" isn't a real time in ${tz} (impossible date/time, or skipped by a daylight-saving change).`);
  return d;
}

/** Org-local wall-clock string for output ("2026-10-07T18:00"). */
export const local = (d: Date | null | undefined, tz: string) => (d ? toLocalInput(d, tz) : null);

export function personName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** "Maya Rivera" → { firstName: "Maya", lastName: "Rivera" }; "Cher" → lastName "". */
export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/** Find a production in the caller's org by id or exact (case-insensitive) title. */
export async function getProduction(ctx: Ctx, ref: string, q: Q = db) {
  const r = ref.trim();
  if (isUuid(r)) {
    const p = await q.query.productions.findFirst({ where: and(eq(productions.id, r), eq(productions.orgId, ctx.orgId)) });
    if (p) return p;
    fail(`No production with id ${r} in ${ctx.orgName}.`);
  }
  const rows = await q
    .select()
    .from(productions)
    .where(and(eq(productions.orgId, ctx.orgId), ilike(productions.title, r.replace(/[%_\\]/g, "\\$&"))));
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) fail(`Several productions are titled "${r}"; pass the production id instead.`);
  return fail(`No production titled "${r}" in ${ctx.orgName}. Use list_productions to see ids.`);
}

/** All org people, for matching by email / name. */
export async function loadOrgPeople(ctx: Ctx, q: Q = db) {
  return q.select().from(people).where(eq(people.orgId, ctx.orgId));
}

type PersonRow = typeof people.$inferSelect;

/** Resolve a person reference (id, email, or full name) against preloaded org people. */
export function matchPerson(all: PersonRow[], ref: string): PersonRow | null {
  const r = ref.trim();
  if (isUuid(r)) return all.find((p) => p.id === r) ?? null;
  if (r.includes("@")) return all.find((p) => norm(p.email) === norm(r)) ?? null;
  const byName = all.filter((p) => norm(personName(p)) === norm(r));
  if (byName.length > 1) fail(`"${r}" matches ${byName.length} people; use their id or email.`);
  return byName[0] ?? null;
}

export function resolvePerson(all: PersonRow[], ref: string): PersonRow {
  const p = matchPerson(all, ref);
  if (!p) fail(`No person "${ref}" in this organization. Add them with upsert_people first, or use list_people.`);
  return p!;
}

/** Shorten a list for error messages. */
export const listForError = (xs: string[], n = 40) =>
  xs.length > n ? `${xs.slice(0, n).join(", ")} … (+${xs.length - n} more)` : xs.join(", ");
