"use client";

import { Check, ClipboardCopy, Download, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Notice, buttonClass, cn } from "@/components/ui";
import { importSheet, type ImportResult } from "./actions";
import {
  COLUMNS,
  MAX_ROWS,
  TEMPLATES,
  parseSheet,
  sameRole,
  toCsv,
  toTsv,
  unknownRoles,
  type CastRow,
  type RoleRow,
  type SceneRow,
  type SheetKind,
} from "./sheet";

type Existing = { roles: string[]; scenes: string[]; emails: string[]; names: string[] };

const TABS: { kind: SheetKind; label: string; help: string }[] = [
  { kind: "roles", label: "Roles", help: "One row per character or ensemble: Role, Kind (lead / supporting / featured / ensemble), Description." },
  { kind: "scenes", label: "Scenes", help: "Act, Scene, Name, Songs, Roles (separated by ;), Pages. A scene's roles are replaced when the row lists any." },
  {
    kind: "cast",
    label: "Cast",
    help: "First name, Last name, Email, Minor (yes/no), Guardian name, Guardian email, Roles (separated by ;), Kind (primary / understudy / swing).",
  },
];

const NOUNS: Record<SheetKind, [string, string]> = {
  roles: ["role", "roles"],
  scenes: ["scene", "scenes"],
  cast: ["cast member", "cast members"],
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function Importer({ productionId, existing }: { productionId: string; existing: Existing }) {
  const [kind, setKind] = useState<SheetKind>("roles");
  const [texts, setTexts] = useState<Record<SheetKind, string>>({ roles: "", scenes: "", cast: "" });
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const text = texts[kind];
  const sheet = useMemo(() => parseSheet(kind, text), [kind, text]);
  const unknown = useMemo(() => (kind === "roles" ? [] : unknownRoles(sheet, existing.roles)), [kind, sheet, existing.roles]);
  const valid = sheet.rows.filter((r) => r.value).length;
  const invalid = sheet.rows.length - valid;
  const tab = TABS.find((t) => t.kind === kind)!;

  const switchTab = (k: SheetKind) => {
    setKind(k);
    setResult(null);
    setSkip(new Set());
  };

  const status = (v: RoleRow | SceneRow | CastRow): "new" | "update" => {
    if (kind === "roles") return existing.roles.some((r) => sameRole(r, (v as RoleRow).name)) ? "update" : "new";
    if (kind === "scenes") {
      const s = v as SceneRow;
      return existing.scenes.includes(`${s.act}|${norm(s.number)}`) ? "update" : "new";
    }
    const c = v as CastRow;
    const byEmail = c.email && existing.emails.includes(c.email);
    const byName = existing.names.includes(norm(`${c.firstName} ${c.lastName}`));
    return byEmail || byName ? "update" : "new";
  };

  const template = TEMPLATES[kind];
  const doImport = () =>
    startTransition(async () => {
      try {
        const res = await importSheet(productionId, { kind, text, skipRoles: [...skip] });
        setResult(res);
        if (res.ok) setSkip(new Set());
      } catch {
        setResult({ error: "Import failed. Check your connection and try again." });
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            aria-selected={kind === t.kind}
            onClick={() => switchTab(t.kind)}
            className={cn(
              "min-h-11 rounded-lg px-3 text-sm font-medium",
              kind === t.kind ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted">{tab.help}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={async () => {
            await navigator.clipboard.writeText(toTsv(template));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {copied ? "Copied. Paste into a sheet" : "Copy template"}
        </button>
        <a
          className={buttonClass("secondary")}
          download={`calltime-${kind}-template.csv`}
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(template))}`}
        >
          <Download className="size-4" /> Download CSV
        </a>
        <button type="button" className={buttonClass("ghost")} onClick={() => setTexts({ ...texts, [kind]: toTsv(template) })}>
          Try the example
        </button>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Paste from Google Sheets, Excel or a CSV file</span>
        <textarea
          value={text}
          onChange={(e) => {
            setTexts({ ...texts, [kind]: e.target.value });
            setResult(null);
          }}
          rows={7}
          spellCheck={false}
          placeholder={`Select the cells in your spreadsheet (header row included), copy, and paste here.\n\n${toTsv(template.slice(0, 2))}`}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-base sm:text-sm"
        />
      </label>

      {sheet.rows.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">{valid} ready</Badge>
            {invalid ? <Badge tone="danger">{invalid} with problems (skipped)</Badge> : null}
            <span className="text-muted">
              {sheet.hasHeader ? "Header row detected." : "No header row: columns read in template order."}
              {sheet.rows.length >= MAX_ROWS ? ` Only the first ${MAX_ROWS} rows are used.` : ""}
            </span>
          </div>

          {unknown.length ? (
            <div className="space-y-2 rounded-xl border border-warn/40 bg-warn-soft p-3">
              <p className="text-sm font-medium text-warn">
                {unknown.length} role{unknown.length === 1 ? "" : "s"} not in this show yet. Create {unknown.length === 1 ? "it" : "them"}?
              </p>
              <p className="text-xs text-warn">Unchecked roles are left out of the import (check spelling against the Roles tab).</p>
              <div className="flex flex-wrap gap-2">
                {unknown.map((name) => {
                  const on = !skip.has(name);
                  return (
                    <label
                      key={name}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm",
                        on ? "border-accent bg-surface text-ink" : "border-line bg-surface text-muted line-through",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const next = new Set(skip);
                          if (e.target.checked) next.delete(name);
                          else next.add(name);
                          setSkip(next);
                        }}
                        className="size-4 accent-[var(--accent)]"
                      />
                      Create “{name}”
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="-mx-4 overflow-x-auto border-y border-line bg-surface sm:mx-0 sm:rounded-2xl sm:border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs font-semibold text-muted">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Status</th>
                  {COLUMNS[kind].map((c) => (
                    <th key={c.key} className="px-3 py-2">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sheet.rows.map((r) => (
                  <tr key={r.line} className={cn(!r.value && "bg-danger-soft/40")}>
                    <td className="px-3 py-2 align-top text-xs tabular-nums text-muted">{r.line}</td>
                    <td className="px-3 py-2 align-top">
                      {r.value ? (
                        status(r.value) === "new" ? (
                          <Badge tone="accent">New</Badge>
                        ) : (
                          <Badge>Update</Badge>
                        )
                      ) : (
                        <span className="block max-w-56 text-xs text-danger">{r.errors.join(". ")}</span>
                      )}
                    </td>
                    <PreviewCells kind={kind} row={r.value} unknown={unknown} skip={skip} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {result?.error ? <Notice tone="danger">{result.error}</Notice> : null}
      {result?.ok ? (
        <Notice tone="success">
          <p className="font-semibold">Imported.</p>
          <ul className="mt-1 list-disc pl-5">
            {result.summary?.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {result.skippedRows ? <li>{result.skippedRows} row(s) with problems were skipped</li> : null}
          </ul>
          <p className="mt-2">
            <Link href={`/p/${productionId}/${kind === "cast" ? "cast" : kind}`} className="font-medium underline">
              Review {kind} →
            </Link>
          </p>
        </Notice>
      ) : null}

      <div className="sticky bottom-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+12px)] z-10 rounded-full bg-bg sm:w-fit md:bottom-4">
        <Button type="button" onClick={doImport} disabled={pending || valid === 0} className="w-full shadow-overlay sm:w-auto">
          <Upload className="size-4" />
          {pending ? "Importing…" : valid ? `Import ${valid} ${NOUNS[kind][valid === 1 ? 0 : 1]}` : "Paste rows to import"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        Safe to run again: existing roles, scenes and people are matched and updated, never duplicated, and nothing is deleted.
      </p>
    </div>
  );
}

function RoleChips({ names, unknown, skip }: { names: string[]; unknown: string[]; skip: Set<string> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => {
        const isNew = unknown.some((u) => sameRole(u, n));
        const skipped = [...skip].some((s) => sameRole(s, n));
        return (
          <Badge key={n} tone={skipped ? "neutral" : isNew ? "warn" : "neutral"} className={cn(skipped && "line-through")}>
            {n}
            {isNew && !skipped ? " (new)" : ""}
          </Badge>
        );
      })}
    </span>
  );
}

function PreviewCells({
  kind,
  row,
  unknown,
  skip,
}: {
  kind: SheetKind;
  row?: RoleRow | SceneRow | CastRow;
  unknown: string[];
  skip: Set<string>;
}) {
  const td = "px-3 py-2 align-top";
  if (!row) return <td colSpan={COLUMNS[kind].length} className={cn(td, "text-xs text-muted")} />;
  if (kind === "roles") {
    const r = row as RoleRow;
    return (
      <>
        <td className={cn(td, "font-medium")}>{r.name}</td>
        <td className={td}>{r.kind ?? <span className="text-muted">supporting</span>}</td>
        <td className={cn(td, "max-w-64 text-muted")}>{r.description}</td>
      </>
    );
  }
  if (kind === "scenes") {
    const s = row as SceneRow;
    return (
      <>
        <td className={td}>{s.act}</td>
        <td className={td}>{s.number}</td>
        <td className={cn(td, "font-medium")}>{s.name}</td>
        <td className={cn(td, "max-w-48 text-muted")}>{s.songs}</td>
        <td className={td}>
          <RoleChips names={s.roles} unknown={unknown} skip={skip} />
        </td>
        <td className={td}>{s.pages}</td>
      </>
    );
  }
  const c = row as CastRow;
  return (
    <>
      <td className={cn(td, "font-medium")}>{c.firstName}</td>
      <td className={td}>{c.lastName}</td>
      <td className={td}>{c.email}</td>
      <td className={td}>{c.isMinor === undefined ? <span className="text-muted">–</span> : c.isMinor ? "Yes" : "No"}</td>
      <td className={td}>{c.guardianName}</td>
      <td className={td}>{c.guardianEmail}</td>
      <td className={td}>
        <RoleChips names={c.roles} unknown={unknown} skip={skip} />
      </td>
      <td className={td}>{c.kind}</td>
    </>
  );
}
