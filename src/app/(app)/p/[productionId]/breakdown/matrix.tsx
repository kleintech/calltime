"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, cn } from "@/components/ui";
import { applyBreakdownChanges } from "./actions";

type Scene = { id: string; act: number; number: string; name: string };
type Role = { id: string; name: string; kind: string; castCount: number };

const KIND_LABEL: Record<string, string> = { lead: "Leads", supporting: "Supporting", featured: "Featured", ensemble: "Ensemble" };
const key = (s: string, r: string) => `${s}:${r}`;
const short = (s: Scene) => `${s.act}·${s.number}`;

/**
 * The classic scene breakdown: roles down the side, scenes across the top. Tapping a cell toggles
 * whether the role appears in the scene (optimistic; rolls back if the server refuses).
 */
export function BreakdownMatrix({
  productionId,
  scenes,
  roles,
  initial,
  rehearsed,
}: {
  productionId: string;
  scenes: Scene[];
  roles: Role[];
  initial: string[];
  /** sceneId → times rehearsed (scene calls in past published events); omitted before rehearsals start. */
  rehearsed?: Record<string, { count: number; daysAgo: number | null }>;
}) {
  const [cells, setCells] = useState(() => new Set(initial));
  const [error, setError] = useState<string | null>(null);
  // "auto" = by scene on phones, grid from md up (CSS decides, so no hydration flash).
  const [view, setView] = useState<"auto" | "grid" | "scene">("auto");
  const [sceneIdx, setSceneIdx] = useState(0);

  // Taps update the grid instantly; saves are batched (debounced) so a burst of taps becomes one
  // transaction and families get one change per affected rehearsal, not one per tap.
  const saved = useRef(new Set(initial)); // what the server has (updated as each batch resolves)
  const pending = useRef(new Map<string, boolean>()); // key → desired state, not yet sent
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current.size) return;
    setSaving(true);
    // Sends are serialized, and each batch is built only when its turn comes — i.e. once the previous
    // request has resolved and `saved` reflects what the server really holds. Building it at flush
    // time would compare a re-toggle made during an in-flight save against stale state and drop it
    // (on → sent off → tapped on again → "already on", so the server stays off while the grid says on).
    inFlight.current = inFlight.current.then(async () => {
      const batch = [...pending.current].filter(([k, on]) => saved.current.has(k) !== on);
      pending.current.clear();
      if (batch.length) {
        let failed: string | null = null;
        try {
          const res = await applyBreakdownChanges(
            productionId,
            batch.map(([k, on]) => {
              const [sceneId, roleId] = k.split(":");
              return { sceneId, roleId, on };
            }),
          );
          if (res.ok) {
            for (const [k, on] of batch) {
              if (on) saved.current.add(k);
              else saved.current.delete(k);
            }
            if (res.affected)
              setNotice(`Calls updated for ${res.affected} ${res.affected === 1 ? "person" : "people"} at upcoming rehearsals; their families were notified.`);
          } else failed = res.error;
        } catch {
          failed = "Couldn't save those changes. Check your connection and try again.";
        }
        if (failed) {
          setError(failed);
          // Roll the failed cells back to what the server has (unless re-toggled since).
          setCells((prev) => {
            const next = new Set(prev);
            for (const [k] of batch) {
              if (pending.current.has(k)) continue;
              if (saved.current.has(k)) next.add(k);
              else next.delete(k);
            }
            return next;
          });
        }
      }
      if (!pending.current.size) setSaving(false);
    });
  }, [productionId]);

  // Save anything still queued when leaving the page. React unmount alone isn't enough: closing the
  // tab or backgrounding it on a phone within the debounce never unmounts, so also flush when the
  // page is hidden (visibilitychange fires before pagehide/unload and is the reliable one on mobile).
  // A request started during unload can still be cancelled by the browser; this narrows the window.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onPageHide = () => flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
  }, [flush]);

  const toggle = (sceneId: string, roleId: string) => {
    const k = key(sceneId, roleId);
    const on = !cells.has(k);
    setCells((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
    setError(null);
    pending.current.set(k, on);
    setSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  const sceneCount = (sid: string) => roles.reduce((n, r) => n + (cells.has(key(sid, r.id)) ? 1 : 0), 0);
  const roleCount = (rid: string) => scenes.reduce((n, s) => n + (cells.has(key(s.id, rid)) ? 1 : 0), 0);
  const acts = [...new Set(scenes.map((s) => s.act))].map((a) => ({ act: a, count: scenes.filter((s) => s.act === a).length }));
  const kinds = ["lead", "supporting", "featured", "ensemble"].filter((k) => roles.some((r) => r.kind === k));
  const scene = scenes[Math.min(sceneIdx, scenes.length - 1)];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
          {(["scene", "grid"] as const).map((v) => {
            const active =
              view === v
                ? "bg-surface shadow-sm text-ink"
                : view === "auto"
                  ? v === "scene"
                    ? "bg-surface shadow-sm text-ink md:bg-transparent md:shadow-none md:text-muted"
                    : "text-muted md:bg-surface md:shadow-sm md:text-ink"
                  : "text-muted";
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn("min-h-11 whitespace-nowrap rounded-lg px-3", active)}
              >
                {v === "grid" ? "Grid" : "One scene"}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted" aria-live="polite">{saving ? "Saving…" : "Tap to toggle · saves automatically"}</p>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice && !error ? <Notice tone="success">{notice}</Notice> : null}

      {view !== "scene" ? (
        <div className={cn(view === "auto" && "hidden md:block")}>
        <div className="-mx-4 overflow-x-auto border-y border-line bg-surface sm:mx-0 sm:rounded-2xl sm:border">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-surface" />
                {acts.map((a) => (
                  <th
                    key={a.act}
                    scope="colgroup"
                    colSpan={a.count}
                    className="border-b border-l border-line bg-surface-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted"
                  >
                    {a.act === 0 ? "Prologue" : `Act ${a.act}`}
                  </th>
                ))}
                <th className="bg-surface" />
              </tr>
              <tr>
                <th className="sticky left-0 z-20 border-b border-r border-line bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">
                  Role
                </th>
                {scenes.map((s, i) => (
                  <th
                    key={s.id}
                    scope="col"
                    title={`Act ${s.act}, ${s.number}: ${s.name}`}
                    className={cn(
                      "h-28 w-11 min-w-11 border-b border-line px-0 align-bottom font-medium",
                      (i === 0 || scenes[i - 1].act !== s.act) && "border-l",
                    )}
                  >
                    <div className="mx-auto flex h-full flex-col items-center justify-end gap-1 pb-1">
                      <span className="max-h-20 overflow-hidden text-xs text-muted [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
                        {s.name}
                      </span>
                      <span className="text-xs font-semibold text-accent">{s.number}</span>
                    </div>
                  </th>
                ))}
                <th scope="col" className="border-b border-l border-line px-2 text-xs font-semibold text-muted">#</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <KindRows
                  key={k}
                  label={KIND_LABEL[k]}
                  roles={roles.filter((r) => r.kind === k)}
                  scenes={scenes}
                  cells={cells}
                  toggle={toggle}
                  roleCount={roleCount}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r border-t border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-muted">
                  Roles in scene
                </td>
                {scenes.map((s, i) => (
                  <td
                    key={s.id}
                    className={cn(
                      "border-t border-line bg-surface-2 py-2 text-center text-xs font-semibold tabular-nums",
                      (i === 0 || scenes[i - 1].act !== s.act) && "border-l",
                    )}
                  >
                    {sceneCount(s.id)}
                  </td>
                ))}
                <td className="border-l border-t border-line bg-surface-2" />
              </tr>
              {rehearsed ? (
                <tr>
                  <td className="sticky left-0 z-10 border-r border-t border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-muted">
                    Times rehearsed
                  </td>
                  {scenes.map((s, i) => {
                    const r = rehearsed[s.id];
                    const stale = !r || r.daysAgo === null || r.daysAgo > 14;
                    return (
                      <td
                        key={s.id}
                        title={r?.daysAgo != null ? `Last rehearsed ${r.daysAgo} days ago` : "Not rehearsed yet"}
                        className={cn(
                          "border-t border-line bg-surface-2 py-2 text-center text-xs font-semibold tabular-nums",
                          stale && "text-warn",
                          (i === 0 || scenes[i - 1].act !== s.act) && "border-l",
                        )}
                      >
                        {r?.count ?? 0}
                        {stale ? "!" : ""}
                      </td>
                    );
                  })}
                  <td className="border-l border-t border-line bg-surface-2" />
                </tr>
              ) : null}
            </tfoot>
          </table>
        </div>
        </div>
      ) : null}
      {view !== "grid" && scene ? (
        <div className={cn("space-y-3", view === "auto" && "md:hidden")}>
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2">
            <button
              type="button"
              aria-label="Previous scene"
              disabled={sceneIdx === 0}
              onClick={() => setSceneIdx((i) => Math.max(0, i - 1))}
              className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2 disabled:opacity-30"
            >
              <ChevronLeft className="size-5" />
            </button>
            <select
              value={scene.id}
              onChange={(e) => setSceneIdx(scenes.findIndex((s) => s.id === e.target.value))}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-2 text-base font-medium"
              aria-label="Scene"
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {short(s)} — {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next scene"
              disabled={sceneIdx >= scenes.length - 1}
              onClick={() => setSceneIdx((i) => Math.min(scenes.length - 1, i + 1))}
              className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2 disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
          <p className="text-sm text-muted">
            {sceneCount(scene.id)} of {roles.length} roles in this scene
            {rehearsed
              ? ` · ${
                  rehearsed[scene.id]?.count
                    ? `rehearsed ${rehearsed[scene.id].count}×, last ${rehearsed[scene.id].daysAgo} days ago`
                    : "not rehearsed yet"
                }`
              : ""}
          </p>
          {kinds.map((k) => (
            <div key={k}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{KIND_LABEL[k]}</p>
              <div className="flex flex-wrap gap-2">
                {roles
                  .filter((r) => r.kind === k)
                  .map((r) => {
                    const on = cells.has(key(scene.id, r.id));
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(scene.id, r.id)}
                        className={cn(
                          "min-h-11 rounded-full border px-4 text-sm font-medium transition active:scale-[.97]",
                          on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink",
                        )}
                      >
                        {r.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KindRows({
  label,
  roles,
  scenes,
  cells,
  toggle,
  roleCount,
}: {
  label: string;
  roles: Role[];
  scenes: Scene[];
  cells: Set<string>;
  toggle: (sceneId: string, roleId: string) => void;
  roleCount: (roleId: string) => number;
}) {
  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 border-b border-r border-line bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </td>
        <td colSpan={scenes.length + 1} className="border-b border-line bg-surface-2" />
      </tr>
      {roles.map((r) => (
        <tr key={r.id} className="group">
          <th
            scope="row"
            className="sticky left-0 z-10 max-w-36 border-b border-r border-line bg-surface px-3 py-0 text-left font-medium group-hover:bg-surface-2"
          >
            <span className="block truncate">{r.name}</span>
            {r.castCount === 0 ? <span className="block text-xs font-normal text-warn">not cast</span> : null}
          </th>
          {scenes.map((s, i) => {
            const on = cells.has(key(s.id, r.id));
            return (
              <td
                key={s.id}
                className={cn("border-b border-line p-0 text-center", (i === 0 || scenes[i - 1].act !== s.act) && "border-l")}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${r.name} in ${s.name}`}
                  onClick={() => toggle(s.id, r.id)}
                  className="flex size-11 items-center justify-center hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "size-6 rounded-md transition",
                      on ? "bg-accent shadow-sm" : "border border-dashed border-line",
                    )}
                  />
                </button>
              </td>
            );
          })}
          <td className="border-b border-l border-line px-2 text-center text-xs tabular-nums text-muted">{roleCount(r.id)}</td>
        </tr>
      ))}
    </>
  );
}
