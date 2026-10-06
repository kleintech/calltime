"use client";

import { ArrowDown, ArrowUp, ChevronDown, Plus, TriangleAlert, Trash, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Avatar, Button, Field, Input, Notice, Textarea, cn } from "@/components/ui";
import {
  EVENT_KINDS,
  KIND_META,
  callKey,
  overlaps,
  type BlockInput,
  type CallRef,
  type EditorOptions,
  type EventInput,
  type EventKind,
} from "@/lib/schedule-shared";
import { fmtRange, fromLocalInput } from "@/lib/time";
import { saveEvent } from "../actions";
import { CallPicker } from "./call-picker";

type Block = BlockInput & { key: string; more: boolean };
type Status = "draft" | "published" | "cancelled" | null;

let seq = 0;
const newKey = () => `b${++seq}`;

const LEADERS = ["Director", "Choreographer", "Music Director", "Stage Manager", "Assistant Director", "Vocal Coach"];

function addMinutes(t: string, mins: number) {
  const [h, m] = t.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + mins));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function EventEditor({
  productionId,
  options,
  initial,
  status,
}: {
  productionId: string;
  options: EditorOptions;
  initial: EventInput;
  status: Status;
}) {
  const router = useRouter();
  const tz = options.tz;
  const [ev, setEv] = useState({
    kind: initial.kind,
    title: initial.title,
    date: initial.date,
    start: initial.start,
    end: initial.end,
    location: initial.location ?? "",
    notes: initial.notes ?? "",
  });
  const [blocks, setBlocks] = useState<Block[]>(() =>
    initial.blocks.map((b) => ({ ...b, key: newKey(), more: !!(b.location || b.notes) })),
  );
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const personById = useMemo(() => new Map(options.people.map((p) => [p.id, p])), [options.people]);
  const set = <K extends keyof typeof ev>(k: K, v: (typeof ev)[K]) => setEv((e) => ({ ...e, [k]: v }));
  const patchBlock = (key: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const instant = useCallback(
    (t: string) => {
      try {
        return fromLocalInput(ev.date, tz, t);
      } catch {
        return null;
      }
    },
    [ev.date, tz],
  );

  /* Live preview: union of people resolved by the call engine per target (precomputed on the server). */
  const preview = useMemo(() => {
    const perBlock = blocks.map((b) => {
      const ids = new Set<string>();
      for (const c of b.calls) for (const p of options.resolved[callKey(c)] ?? (c.targetId ? [c.targetId] : [])) ids.add(p);
      const s = instant(b.start);
      const e = instant(b.end);
      const clashes =
        s && e
          ? options.conflicts.filter((c) => ids.has(c.personId) && overlaps(s, e, new Date(c.startsAt), new Date(c.endsAt)))
          : [];
      return { ids, clashes };
    });
    const calls = new Map<string, { personId: string; start: string; end: string; reasons: string[]; conflict: boolean }>();
    blocks.forEach((b, i) => {
      for (const pid of perBlock[i].ids) {
        const reasons = b.calls
          .filter((c) => (options.resolved[callKey(c)] ?? [c.targetId]).includes(pid))
          .map((c) => (b.title && c.target !== "scene" ? b.title : options.labels[callKey(c)] ?? "Called"));
        const conflict = perBlock[i].clashes.some((c) => c.personId === pid);
        const cur = calls.get(pid);
        if (!cur) calls.set(pid, { personId: pid, start: b.start, end: b.end, reasons: [...new Set(reasons)], conflict });
        else {
          if (b.start < cur.start) cur.start = b.start;
          if (b.end > cur.end) cur.end = b.end;
          cur.reasons = [...new Set([...cur.reasons, ...reasons])];
          cur.conflict ||= conflict;
        }
      }
    });
    const list = [...calls.values()].sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        (personById.get(a.personId)?.name ?? "").localeCompare(personById.get(b.personId)?.name ?? ""),
    );
    return { perBlock, list };
  }, [blocks, options, instant, personById]);

  const totalClashes = new Set(preview.perBlock.flatMap((p) => p.clashes.map((c) => c.id))).size;

  const addBlock = () => {
    const last = blocks.at(-1);
    const s = last ? last.end : ev.start;
    let e = addMinutes(s, 60);
    if (ev.end > s && ev.end < e) e = ev.end;
    if (e <= s) e = addMinutes(s, 30);
    setBlocks((bs) => [...bs, { key: newKey(), start: s, end: e, title: "", leader: "", location: "", notes: "", calls: [], more: false }]);
  };
  const move = (i: number, d: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const setKind = (k: EventKind) =>
    setEv((e) => {
      const autoTitle = !e.title.trim() || EVENT_KINDS.some((x) => KIND_META[x].label === e.title) || e.title === "Saturday Rehearsal";
      return { ...e, kind: k, title: autoTitle ? KIND_META[k].label : e.title };
    });

  const submit = (intent: "save" | "publish" | "draft") => {
    setError(null);
    if (ev.end <= ev.start) return setError("The event must end after it starts.");
    const bad = blocks.findIndex((b) => b.end <= b.start);
    if (bad >= 0) return setError(`Block ${bad + 1} must end after it starts.`);
    if (intent === "publish" && !window.confirm(`Publish this event? ${preview.list.length} ${preview.list.length === 1 ? "person" : "people"} will see their calls, and calendar feeds update automatically.`)) return;
    const payload: EventInput = {
      id: initial.id,
      ...ev,
      changeNote: status === "published" ? changeNote : undefined,
      blocks: blocks.map(({ start, end, title, leader, location, notes, calls }) => ({ start, end, title, leader, location, notes, calls })),
    };
    start(async () => {
      const r = await saveEvent(productionId, payload, intent);
      if (!r.ok) return setError(r.error);
      router.push(`/p/${productionId}/schedule/${r.id}`);
      router.refresh();
    });
  };

  const pickerBlock = blocks.find((b) => b.key === pickerFor);
  const pickerStart = pickerBlock ? instant(pickerBlock.start) : null;
  const pickerEnd = pickerBlock ? instant(pickerBlock.end) : null;
  const pickerRange = pickerStart && pickerEnd ? fmtRange(pickerStart, pickerEnd, tz) : "";
  const pickerClashes = new Set(
    pickerStart && pickerEnd
      ? options.conflicts.filter((c) => overlaps(pickerStart, pickerEnd, new Date(c.startsAt), new Date(c.endsAt))).map((c) => c.personId)
      : [],
  );
  const outside = (b: Block) => b.start < ev.start || b.end > ev.end;

  return (
    <div className="pb-4">
      {status === null || status === "draft" ? (
        <div className="mb-4">
          <Notice tone="warn">Draft — only the creative team can see this until you publish.</Notice>
        </div>
      ) : status === "published" ? (
        <div className="mb-4">
          <Notice>This event is published. Saved changes show up for families (and in their calendars) right away.</Notice>
        </div>
      ) : null}
      {/* ── Event basics ── */}
      <section className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium">Type</span>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            {EVENT_KINDS.map((k) => {
              const Icon = KIND_META[k].icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={ev.kind === k}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium",
                    ev.kind === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
                  )}
                >
                  <Icon className="size-4" /> {KIND_META[k].label}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Title">
          <Input value={ev.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label="Date" className="col-span-2 sm:col-span-1">
            <Input type="date" value={ev.date} onChange={(e) => e.target.value && set("date", e.target.value)} required />
          </Field>
          <Field label="Starts">
            <Input type="time" step={900} value={ev.start} onChange={(e) => e.target.value && set("start", e.target.value)} required />
          </Field>
          <Field label="Ends">
            <Input type="time" step={900} value={ev.end} onChange={(e) => e.target.value && set("end", e.target.value)} required />
          </Field>
        </div>
        <Field label="Location">
          <Input value={ev.location} onChange={(e) => set("location", e.target.value)} placeholder={options.defaultLocation || "Where?"} maxLength={200} />
        </Field>
        <Field label="Notes for cast & families" hint="Shown on the event. e.g. “Bring a lunch”, “Wear character shoes”.">
          <Textarea value={ev.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} className="min-h-20" />
        </Field>
      </section>

      {/* ── Blocks ── */}
      <div className="mb-2 mt-8 flex items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold">Blocks & calls</h2>
          <p className="text-sm text-muted">Each block calls scenes, groups, roles or people. Call times are computed for everyone.</p>
        </div>
      </div>

      <div className="space-y-3">
        {blocks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
            No blocks yet — nobody is called. Add a block to call scenes or people.
          </div>
        ) : null}
        {blocks.map((b, i) => {
          const pv = preview.perBlock[i];
          const isOpen = expanded[b.key];
          return (
            <div key={b.key} className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold">Block {i + 1}</span>
                <div className="flex shrink-0">
                  <button type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move block ${i + 1} up`}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label={`Move block ${i + 1} down`}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                    onClick={() => (b.calls.length === 0 || window.confirm(`Remove block ${i + 1} and its calls?`)) && setBlocks((bs) => bs.filter((x) => x.key !== b.key))}
                    aria-label={`Remove block ${i + 1}`}
                  >
                    <Trash className="size-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="From">
                  <Input type="time" step={900} value={b.start} onChange={(e) => e.target.value && patchBlock(b.key, { start: e.target.value })} />
                </Field>
                <Field label="To">
                  <Input type="time" step={900} value={b.end} onChange={(e) => e.target.value && patchBlock(b.key, { end: e.target.value })} />
                </Field>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Set length">
                {[30, 45, 60, 90].map((m) => {
                  const end = addMinutes(b.start, m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patchBlock(b.key, { end })}
                      aria-pressed={b.end === end}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs font-medium",
                        b.end === end ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink",
                      )}
                    >
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </button>
                  );
                })}
              </div>
              {b.end <= b.start ? <p className="mt-1 text-xs text-danger">Ends before it starts.</p> : outside(b) ? <p className="mt-1 text-xs text-warn">Runs outside the event&apos;s {fmtRange(instant(ev.start) ?? new Date(), instant(ev.end) ?? new Date(), tz)}.</p> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Input value={b.title} onChange={(e) => patchBlock(b.key, { title: e.target.value })} placeholder="Title (optional)" aria-label="Block title" maxLength={200} />
                <Input value={b.leader} onChange={(e) => patchBlock(b.key, { leader: e.target.value })} placeholder="Led by" aria-label="Led by" list="ct-leaders" maxLength={100} />
              </div>
              {b.more ? (
                <div className="mt-2 space-y-2">
                  <Input value={b.location} onChange={(e) => patchBlock(b.key, { location: e.target.value })} placeholder={`Room (default: ${ev.location || options.defaultLocation || "event location"})`} aria-label="Block location" maxLength={200} />
                  <Textarea value={b.notes} onChange={(e) => patchBlock(b.key, { notes: e.target.value })} placeholder="Notes for this block" aria-label="Block notes" className="min-h-16" maxLength={2000} />
                </div>
              ) : (
                <button type="button" className="mt-1 min-h-9 text-xs font-medium text-muted hover:text-ink" onClick={() => patchBlock(b.key, { more: true })}>
                  + Room / notes
                </button>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {b.calls.map((c) => (
                  <span key={callKey(c)} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent-soft pl-3 pr-1 text-sm font-medium text-accent">
                    {options.labels[callKey(c)] ?? "Unknown"}
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-full hover:bg-accent/15"
                      onClick={() => patchBlock(b.key, { calls: b.calls.filter((x) => callKey(x) !== callKey(c)) })}
                      aria-label="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setPickerFor(b.key)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-accent/60 px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                >
                  <UserPlus className="size-4" /> {b.calls.length ? "Edit calls" : "Call scenes / people"}
                </button>
              </div>

              {pv.ids.size > 0 ? (
                <div className="mt-3 border-t border-line pt-2">
                  <button type="button" onClick={() => setExpanded((x) => ({ ...x, [b.key]: !isOpen }))} className="flex min-h-9 w-full items-center gap-2 text-left text-sm text-muted">
                    <Users className="size-4" />
                    <span>
                      <span className="font-semibold text-ink">{pv.ids.size}</span> called
                    </span>
                    {pv.clashes.length ? (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <TriangleAlert className="size-4" /> {pv.clashes.length} conflict{pv.clashes.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <ChevronDown className={cn("ml-auto size-4 transition", isOpen && "rotate-180")} />
                  </button>
                  {pv.clashes.length ? (
                    <ul className="mb-1 space-y-1">
                      {pv.clashes.map((c) => (
                        <li key={c.id} className="rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
                          <span className="font-semibold">{personById.get(c.personId)?.name ?? "Someone"}</span> unavailable{" "}
                          {fmtRange(c.startsAt, c.endsAt, tz)}
                          {c.note ? ` — ${c.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {isOpen ? (
                    <p className="text-sm leading-relaxed">
                      {[...pv.ids]
                        .map((id) => personById.get(id)?.name ?? "Unknown")
                        .sort()
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <Button type="button" variant="secondary" className="w-full border-dashed" onClick={addBlock}>
          <Plus className="size-4" /> Add block
        </Button>
      </div>
      <datalist id="ct-leaders">
        {LEADERS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      {/* ── Event-wide preview ── */}
      <details className="group mt-8 rounded-2xl border border-line bg-surface" open={preview.list.length > 0 && preview.list.length <= 12}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4">
          <Users className="size-5 text-accent" />
          <span className="font-semibold">Who&apos;s called</span>
          <span className="text-sm text-muted">{preview.list.length} {preview.list.length === 1 ? "person" : "people"}</span>
          {totalClashes ? (
            <span className="inline-flex items-center gap-1 text-sm text-warn">
              <TriangleAlert className="size-4" /> {totalClashes}
            </span>
          ) : null}
          <ChevronDown className="ml-auto size-4 text-muted transition group-open:rotate-180" />
        </summary>
        {preview.list.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">No one yet.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {preview.list.map((c) => {
              const p = personById.get(c.personId);
              const s = instant(c.start);
              const e = instant(c.end);
              return (
                <li key={c.personId} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={p?.name ?? "?"} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p?.name ?? "Unknown"}
                      {c.conflict ? <TriangleAlert className="ml-1 inline size-3.5 text-warn" aria-label="Has a conflict" /> : null}
                    </p>
                    <p className="truncate text-xs text-muted">{c.reasons.join(", ")}</p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{s && e ? fmtRange(s, e, tz) : `${c.start}–${c.end}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </details>

      {status === "published" ? (
        <Field label="Tell families what changed (optional)" hint="Shown with the Updated badge on their calls, e.g. “Moved to 6:30 — the hall is booked until then.”" className="mt-6">
          <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={300} />
        </Field>
      ) : null}

      {/* ── Save bar ── */}
      <div className="sticky bottom-[calc(88px+env(safe-area-inset-bottom))] z-30 mt-6 md:bottom-4">
        {error ? (
          <div className="mb-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 shadow-lg backdrop-blur">
          {status === "published" ? (
            <>
              <p className="min-w-0 flex-1 px-2 text-xs text-muted">Changes to times, places or calls show families an “Updated” badge.</p>
              <Button type="button" disabled={pending} onClick={() => submit("save")}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : status === "cancelled" ? (
            <>
              <p className="min-w-0 flex-1 px-2 text-xs text-muted">This event is cancelled.</p>
              <Button type="button" disabled={pending} onClick={() => submit("save")}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={() => submit("draft")}>
                Save draft
              </Button>
              <Button type="button" className="flex-1" disabled={pending} onClick={() => submit("publish")}>
                {pending ? "Saving…" : "Publish"}
              </Button>
            </>
          )}
        </div>
      </div>

      {pickerBlock ? (
        <CallPicker
          options={options}
          selected={pickerBlock.calls as CallRef[]}
          title={`Block ${blocks.indexOf(pickerBlock) + 1} · ${pickerRange}`}
          unavailable={pickerClashes}
          onChange={(calls) => patchBlock(pickerBlock.key, { calls })}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </div>
  );
}
