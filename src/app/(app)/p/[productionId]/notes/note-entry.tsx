"use client";

import { Check, Search, X } from "lucide-react";
import { startTransition, useActionState, useMemo, useState } from "react";
import { Button, Input, Notice, Select, Textarea, cn } from "@/components/ui";
import { createNote, type NoteFormState } from "./actions";

type Person = { id: string; name: string; roles: string[] };
type Option = { id: string; label: string };
const CATS = [
  ["blocking", "Blocking"],
  ["line", "Lines"],
  ["music", "Music"],
  ["choreo", "Choreo"],
  ["character", "Character"],
  ["general", "General"],
] as const;

/** Who + note text. Remounted (via key) after each save so the next note starts clean. */
function Recipients({ people, recent }: { people: Person[]; recent: string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const ordered = useMemo(() => {
    const rank = new Map(recent.map((id, i) => [id, i]));
    return [...people].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || a.name.localeCompare(b.name));
  }, [people, recent]);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? ordered.filter((p) => p.name.toLowerCase().includes(needle) || p.roles.some((r) => r.toLowerCase().includes(needle)))
    : ordered;
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const byId = new Map(people.map((p) => [p.id, p]));

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">For</span>
          {picked.length ? (
            <button type="button" className="min-h-11 px-2 text-sm text-muted hover:text-ink" onClick={() => setPicked([])}>
              Clear
            </button>
          ) : null}
        </div>
        {picked.map((id) => (
          <input key={id} type="hidden" name="personIds" value={id} />
        ))}
        {picked.length ? (
          <div className="flex flex-wrap gap-2">
            {picked.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-medium text-accent-ink"
                aria-label={`Remove ${byId.get(id)?.name}`}
              >
                {byId.get(id)?.name} <X className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or role" aria-label="Find by name or role" className="pl-9" />
        </div>
        <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
          {shown.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm",
                  on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface hover:bg-surface-2",
                )}
              >
                {on ? <Check className="size-3.5" aria-hidden /> : null}
                {p.name}
                {p.roles[0] ? <span className="text-xs text-muted">· {p.roles[0]}</span> : null}
              </button>
            );
          })}
          {shown.length === 0 ? <p className="text-sm text-muted">Nobody matches “{q}”.</p> : null}
        </div>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Note</span>
        <Textarea name="body" rows={3} required placeholder="Cheat out on the second verse; you're upstage of Mabel." />
      </label>
    </>
  );
}

export function NoteEntry({
  productionId,
  people,
  recent,
  scenes,
  events,
  defaultEventId,
}: {
  productionId: string;
  people: Person[];
  recent: string[];
  scenes: Option[];
  events: Option[];
  defaultEventId?: string;
}) {
  const [state, action, pending] = useActionState<NoteFormState, FormData>(createNote, {});
  const [category, setCategory] = useState("general");
  const [sceneId, setSceneId] = useState("");
  const [eventId, setEventId] = useState(defaultEventId ?? "");

  return (
    <form
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="productionId" value={productionId} />
      <input type="hidden" name="category" value={category} />
      <Recipients key={state.savedAt ?? 0} people={people} recent={recent} />

      <div className="space-y-2">
        <span className="text-sm font-medium">Category</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {CATS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={category === k}
              onClick={() => setCategory(k)}
              className={cn(
                "min-h-10 rounded-full border px-3 text-sm",
                category === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Scene (optional)</span>
          <Select name="sceneId" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">No specific scene</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Rehearsal (optional)</span>
          <Select name="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Not tied to a rehearsal</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok && !pending ? <Notice tone="success">{state.ok} Ready for the next one.</Notice> : null}
      <Button type="submit" disabled={pending} className="min-h-12 w-full sm:w-auto">
        {pending ? "Saving…" : "Save note"}
      </Button>
    </form>
  );
}
