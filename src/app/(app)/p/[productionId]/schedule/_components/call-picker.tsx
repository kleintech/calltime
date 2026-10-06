"use client";

import { Check, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";
import { callKey, type CallRef, type CallTargetKind, type EditorOptions } from "@/lib/schedule-shared";

type Tab = "scene" | "group" | "role" | "person" | "all_cast";
const TABS: { id: Tab; label: string }[] = [
  { id: "scene", label: "Scenes" },
  { id: "group", label: "Groups" },
  { id: "role", label: "Roles" },
  { id: "person", label: "People" },
  { id: "all_cast", label: "Everyone" },
];

/**
 * Bottom sheet (phone) / dialog (desktop) for choosing who a block calls.
 * Multi-select chips across tabs; shows how many people each choice calls.
 */
export function CallPicker({
  options,
  selected,
  title,
  unavailable,
  onChange,
  onClose,
}: {
  options: EditorOptions;
  selected: CallRef[];
  title: string;
  /** People with a conflict during this block; choices that call any of them get a warning. */
  unavailable: Set<string>;
  onChange: (calls: CallRef[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("scene");
  const [q, setQ] = useState("");
  const selectedKeys = useMemo(() => new Set(selected.map(callKey)), [selected]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const toggle = (c: CallRef) => {
    const k = callKey(c);
    onChange(selectedKeys.has(k) ? selected.filter((s) => callKey(s) !== k) : [...selected, c]);
  };

  const people = new Set<string>();
  for (const c of selected) for (const p of options.resolved[callKey(c)] ?? []) people.add(p);

  const match = (s: string) => !q || s.toLowerCase().includes(q.trim().toLowerCase());
  const countFor = (target: CallTargetKind, id: string | null) => options.resolved[callKey({ target, targetId: id })]?.length ?? 0;
  const selCount = (t: Tab) => selected.filter((c) => c.target === t).length;

  const chip = (target: CallTargetKind, id: string | null, label: string, sub?: string) => {
    const on = selectedKeys.has(callKey({ target, targetId: id }));
    const n = countFor(target, id);
    const ids = options.resolved[callKey({ target, targetId: id })] ?? (id ? [id] : []);
    const clash = ids.filter((p) => unavailable.has(p)).length;
    return (
      <button
        key={`${target}:${id}`}
        type="button"
        aria-pressed={on}
        onClick={() => toggle({ target, targetId: id })}
        className={cn(
          "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3.5 text-left text-sm transition active:scale-[.98]",
          on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface hover:bg-surface-2",
        )}
      >
        {on ? <Check className="size-4 shrink-0" /> : null}
        <span className="min-w-0 truncate">
          <span className="font-medium">{label}</span>
          {sub ? <span className={cn("ml-1", on ? "opacity-80" : "text-muted")}>{sub}</span> : null}
        </span>
        {clash ? (
          <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-xs", on ? "" : "text-warn")} title={`${clash} unavailable`}>
            <TriangleAlert className="size-3.5" aria-label={`${clash} with a conflict`} />
            {target !== "person" ? clash : null}
          </span>
        ) : null}
        {target !== "person" ? (
          <span className={cn("shrink-0 rounded-full px-1.5 text-xs tabular-nums", on ? "bg-white/20" : "bg-surface-2 text-muted")}>{n}</span>
        ) : null}
      </button>
    );
  };

  const acts = [...new Set(options.scenes.map((s) => s.act))];
  const empty = (what: string) => <p className="py-8 text-center text-sm text-muted">{what}</p>;

  let body: ReactNode;
  if (tab === "scene") {
    const any = options.scenes.some((s) => match(s.label));
    body = !options.scenes.length
      ? empty("No scenes yet. Add them under Scenes, with which roles appear in each.")
      : !any
        ? empty("No matching scenes")
        : acts.map((act) => {
            const list = options.scenes.filter((s) => s.act === act && match(s.label));
            if (!list.length) return null;
            return (
              <div key={act} className="mb-4">
                {act === acts[0] ? <p className="mb-3 text-xs text-muted">Scenes call the primary cast and swings. To include understudies, call the role.</p> : null}
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Act {act}</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => chip("scene", s.id, s.short.replace(/^Act \d+ /, ""), s.name))}
                </div>
              </div>
            );
          });
  } else if (tab === "group") {
    const list = options.groups.filter((g) => match(g.name));
    body = list.length ? <div className="flex flex-wrap gap-2">{list.map((g) => chip("group", g.id, g.name))}</div> : empty(options.groups.length ? "No matching groups" : "No groups yet. Groups bundle roles, like “Pirates” or “Daughters”.");
  } else if (tab === "role") {
    const list = options.roles.filter((r) => match(r.name));
    body = list.length ? (
      <>
        <p className="mb-3 text-xs text-muted">Calling a role includes its understudies.</p>
        <div className="flex flex-wrap gap-2">{list.map((r) => chip("role", r.id, r.name))}</div>
      </>
    ) : (
      empty("No matching roles")
    );
  } else if (tab === "person") {
    const list = options.people.filter((p) => match(p.name));
    body = list.length ? <div className="flex flex-wrap gap-2">{list.map((p) => chip("person", p.id, p.name))}</div> : empty(options.people.length ? "No one matches" : "No one is cast yet.");
  } else {
    body = (
      <div className="space-y-3">
        {chip("all_cast", null, "Full cast")}
        <p className="text-sm text-muted">Everyone with a role in this production ({options.people.length} people).</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[88dvh] w-full flex-col rounded-t-3xl bg-bg shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">Who&apos;s called</p>
            <p className="truncate text-xs text-muted">{title}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setQ("");
                }}
                className={cn(
                  "flex min-h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium",
                  tab === t.id ? "bg-surface text-ink shadow-sm" : "text-muted",
                )}
              >
                {t.label}
                {selCount(t.id) ? <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{selCount(t.id)}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {tab !== "all_cast" ? (
          <div className="relative px-4 pt-3">
            <Search className="pointer-events-none absolute left-7 top-1/2 mt-1.5 size-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${TABS.find((t) => t.id === tab)!.label.toLowerCase()}`}
              className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-ink placeholder:text-muted/70 focus:outline-2 focus:outline-accent"
            />
          </div>
        ) : null}
        <div className="min-h-48 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{body}</div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <p className="min-w-0 flex-1 text-sm text-muted">
            <span className="font-semibold text-ink">{people.size}</span> {people.size === 1 ? "person" : "people"} called
            {selected.length ? ` · ${selected.length} selected` : ""}
          </p>
          {selected.length ? (
            <Button type="button" variant="ghost" onClick={() => onChange([])}>
              Clear
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
