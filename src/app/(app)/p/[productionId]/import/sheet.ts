/**
 * Spreadsheet paste parsing for /p/[id]/import. Pure (no server/client APIs) so the browser can
 * preview exactly what the server action will apply: the server re-parses the same raw text.
 */

export type SheetKind = "roles" | "scenes" | "cast";

export type RoleRow = { name: string; kind?: "lead" | "supporting" | "featured" | "ensemble"; description?: string };
export type SceneRow = { act: number; number: string; name: string; songs?: string; pages?: string; roles: string[] };
export type CastRow = {
  firstName: string;
  lastName: string;
  email?: string;
  /** undefined = column blank: leave an existing person's flag alone. */
  isMinor?: boolean;
  guardianName?: string;
  guardianEmail?: string;
  roles: string[];
  kind: "primary" | "understudy" | "swing";
};

export type ParsedRow<T> = { line: number; cells: string[]; value?: T; errors: string[] };
export type ParsedSheet<T> = { hasHeader: boolean; columns: string[]; rows: ParsedRow<T>[] };

export const MAX_ROWS = 500;

/* ─────────── Columns per sheet (template order) and header aliases ─────────── */

type Col = { key: string; label: string; aliases: string[] };

export const COLUMNS: Record<SheetKind, Col[]> = {
  roles: [
    { key: "name", label: "Role", aliases: ["role", "name", "rolename", "character", "part"] },
    { key: "kind", label: "Kind", aliases: ["kind", "type", "category", "size"] },
    { key: "description", label: "Description", aliases: ["description", "desc", "notes", "about"] },
  ],
  scenes: [
    { key: "act", label: "Act", aliases: ["act"] },
    { key: "number", label: "Scene", aliases: ["scene", "number", "no", "sceneno", "scenenumber", "sc", "num"] },
    { key: "name", label: "Name", aliases: ["name", "title", "scenename", "location", "setting"] },
    { key: "songs", label: "Songs", aliases: ["songs", "song", "music", "numbers", "musicalnumbers"] },
    { key: "roles", label: "Roles", aliases: ["roles", "characters", "who", "cast", "rolesinscene", "parts"] },
    { key: "pages", label: "Pages", aliases: ["pages", "page", "pp"] },
  ],
  cast: [
    { key: "first", label: "First name", aliases: ["first", "firstname", "given", "givenname"] },
    { key: "last", label: "Last name", aliases: ["last", "lastname", "surname", "familyname"] },
    { key: "email", label: "Email", aliases: ["email", "emailaddress", "performeremail", "studentemail"] },
    { key: "minor", label: "Minor", aliases: ["minor", "under18", "isminor", "child", "youth"] },
    { key: "guardianName", label: "Guardian name", aliases: ["guardianname", "guardian", "parent", "parentname", "parentguardian"] },
    { key: "guardianEmail", label: "Guardian email", aliases: ["guardianemail", "parentemail", "parentguardianemail"] },
    { key: "roles", label: "Roles", aliases: ["roles", "role", "part", "parts", "character", "characters"] },
    { key: "kind", label: "Kind", aliases: ["kind", "type", "assignment", "casttype"] },
  ],
};

/** A single full-name column ("Name") is also accepted for cast and split on the first space. */
const CAST_FULLNAME = ["name", "fullname", "performer", "performername", "student", "studentname"];

export const TEMPLATES: Record<SheetKind, string[][]> = {
  roles: [
    ["Role", "Kind", "Description"],
    ["Mabel", "lead", "Soprano, ages 14-18"],
    ["Pirates", "ensemble", ""],
  ],
  scenes: [
    ["Act", "Scene", "Name", "Songs", "Roles", "Pages"],
    ["1", "1", "A Rocky Seashore", "Pour, O Pour the Pirate Sherry", "Pirate King; Frederic; Pirates", "1-6"],
    ["1", "2", "Poor Wand'ring One", "Poor Wand'ring One", "Mabel; Frederic; Daughters", "7-12"],
  ],
  cast: [
    ["First name", "Last name", "Email", "Minor", "Guardian name", "Guardian email", "Roles", "Kind"],
    ["Maya", "Rivera", "", "yes", "Dana Rivera", "dana@example.com", "Mabel", "primary"],
    ["Sam", "Chen", "sam@example.com", "no", "", "", "Frederic", "primary"],
    ["Lila", "Brennan", "", "yes", "Jo Brennan", "jo@example.com", "Mabel; Daughters", "understudy"],
  ],
};

/* ─────────── Delimited text ─────────── */

/** Parse TSV (pasted from Sheets/Excel) or CSV, honoring quotes and quoted newlines. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const firstLine = src.split("\n").find((l) => l.trim()) ?? "";
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

export function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}

export const toTsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Map header cells to column keys; null if this row doesn't look like a header. */
function detectHeader(kind: SheetKind, cells: string[]): (string | null)[] | null {
  const cols = COLUMNS[kind];
  const mapped = cells.map((c) => {
    const k = key(c);
    if (!k) return null;
    if (kind === "cast" && CAST_FULLNAME.includes(k)) return "fullName";
    return cols.find((col) => col.aliases.includes(k))?.key ?? null;
  });
  const hits = mapped.filter(Boolean).length;
  // A header needs at least two recognised columns (or one, when the paste is a single column).
  return hits >= Math.min(2, cells.length) ? mapped : null;
}

function parseKind<T extends string>(raw: string, map: Record<string, T>): T | undefined | null {
  const k = key(raw);
  if (!k) return undefined;
  return map[k] ?? null; // null = invalid
}

const ROLE_KINDS: Record<string, RoleRow["kind"] & string> = {
  lead: "lead",
  leads: "lead",
  principal: "lead",
  supporting: "supporting",
  support: "supporting",
  featured: "featured",
  feature: "featured",
  cameo: "featured",
  ensemble: "ensemble",
  chorus: "ensemble",
};
const ASSIGN_KINDS: Record<string, CastRow["kind"]> = {
  primary: "primary",
  main: "primary",
  cast: "primary",
  understudy: "understudy",
  us: "understudy",
  cover: "understudy",
  swing: "swing",
};
const YES = new Set(["y", "yes", "true", "1", "x", "minor", "under18"]);
const NO = new Set(["n", "no", "false", "0", "adult"]);

export function parseSheet(kind: "roles", text: string): ParsedSheet<RoleRow>;
export function parseSheet(kind: "scenes", text: string): ParsedSheet<SceneRow>;
export function parseSheet(kind: "cast", text: string): ParsedSheet<CastRow>;
export function parseSheet(kind: SheetKind, text: string): ParsedSheet<RoleRow | SceneRow | CastRow>;
export function parseSheet(kind: SheetKind, text: string): ParsedSheet<RoleRow | SceneRow | CastRow> {
  const all = parseDelimited(text);
  if (!all.length) return { hasHeader: false, columns: COLUMNS[kind].map((c) => c.key), rows: [] };
  const header = detectHeader(kind, all[0]);
  const colKeys: (string | null)[] = header ?? COLUMNS[kind].map((c) => c.key);
  const body = (header ? all.slice(1) : all).slice(0, MAX_ROWS);
  const offset = header ? 2 : 1;

  const rows = body.map((cells, i) => {
    const get = (k: string) => {
      const idx = colKeys.indexOf(k);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const errors: string[] = [];
    let value: RoleRow | SceneRow | CastRow | undefined;

    if (kind === "roles") {
      const name = get("name");
      const k = parseKind(get("kind"), ROLE_KINDS);
      if (!name) errors.push("Role name is missing");
      if (k === null) errors.push(`Kind "${get("kind")}" should be lead, supporting, featured or ensemble`);
      value = { name, kind: k ?? undefined, description: get("description") || undefined };
    } else if (kind === "scenes") {
      const actRaw = get("act").replace(/^act\s*/i, "");
      const act = actRaw === "" ? 1 : /^\d+$/.test(actRaw) ? Number(actRaw) : romanToInt(actRaw);
      const number = get("number").replace(/^(scene|sc\.?)\s*/i, "");
      const name = get("name");
      if (act === null || act > 20) errors.push(`Act "${get("act")}" should be a number`);
      if (!number) errors.push("Scene number is missing");
      if (!name) errors.push("Scene name is missing");
      value = {
        act: act ?? 1,
        number,
        name,
        songs: get("songs") || undefined,
        pages: get("pages") || undefined,
        roles: splitList(get("roles")),
      };
    } else {
      let first = get("first");
      let last = get("last");
      if (!first && colKeys.includes("fullName")) {
        const parts = get("fullName").split(/\s+/).filter(Boolean);
        first = parts[0] ?? "";
        last = parts.slice(1).join(" ");
      }
      const email = get("email").toLowerCase();
      const gEmail = get("guardianEmail").toLowerCase();
      const minorRaw = key(get("minor"));
      const k = parseKind(get("kind"), ASSIGN_KINDS);
      if (!first) errors.push("First name is missing");
      if (email && !EMAIL.test(email)) errors.push(`"${email}" isn't an email address`);
      if (gEmail && !EMAIL.test(gEmail)) errors.push(`Guardian email "${gEmail}" isn't an email address`);
      if (minorRaw && !YES.has(minorRaw) && !NO.has(minorRaw)) errors.push(`Minor should be yes or no, not "${get("minor")}"`);
      if (k === null) errors.push(`Kind "${get("kind")}" should be primary, understudy or swing`);
      if (gEmail && !get("guardianName")) errors.push("Guardian email given without a guardian name");
      value = {
        firstName: first,
        lastName: last,
        email: email || undefined,
        // A guardian implies a minor even when the column is blank.
        isMinor: minorRaw ? YES.has(minorRaw) : get("guardianName") ? true : undefined,
        guardianName: get("guardianName") || undefined,
        guardianEmail: gEmail || undefined,
        roles: splitList(get("roles")),
        kind: k ?? "primary",
      };
    }
    return { line: i + offset, cells, value: errors.length ? undefined : value, errors };
  });
  return { hasHeader: !!header, columns: colKeys.map((k) => k ?? ""), rows };
}

function romanToInt(s: string): number | null {
  const m: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  return m[s.toLowerCase()] ?? null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Role names referenced by the sheet that don't match an existing role (case-insensitive). */
export function unknownRoles(sheet: ParsedSheet<RoleRow | SceneRow | CastRow>, existing: string[]) {
  const have = new Set(existing.map(norm));
  const out = new Map<string, string>();
  for (const r of sheet.rows) {
    const v = r.value as Partial<SceneRow & CastRow> | undefined;
    for (const name of v?.roles ?? []) if (!have.has(norm(name)) && !out.has(norm(name))) out.set(norm(name), name);
  }
  return [...out.values()];
}

export const sameRole = (a: string, b: string) => norm(a) === norm(b);
