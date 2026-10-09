"use client";

import { Check, Trash } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button, Checkbox, Field, Input, Notice, Select, cn } from "@/components/ui";
import { personColor } from "@/lib/schedule-shared";
import { addConflict, deleteConflict, type ConflictState } from "./actions";

type PersonOpt = { id: string; name: string; productions: { id: string; title: string }[] };

export type ConflictPrefill = { personId?: string; date?: string; start?: string; end?: string };

export function ConflictForm({ persons, today, prefill }: { persons: PersonOpt[]; today: string; prefill: ConflictPrefill }) {
  const [state, action, pending] = useActionState<ConflictState, FormData>(addConflict, {});
  // No default when several people: a parent must pick, so Maya's dentist visit isn't filed under Leo.
  const initialPeople = persons.length === 1 ? [persons[0].id] : prefill.personId ? [prefill.personId] : [];
  const [picked, setPicked] = useState<string[]>(initialPeople);
  const [allDay, setAllDay] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const prods = [...new Map(persons.filter((p) => picked.includes(p.id)).flatMap((p) => p.productions).map((x) => [x.id, x])).values()];

  useEffect(() => {
    if (state.ok) formRef.current?.reset(); // keep who's picked: families often add several dates for one kid
  }, [state.at, state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">Saved. The creative team sees it while building the schedule.</Notice> : null}
      {persons.length > 1 ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Who can&apos;t make it?</legend>
          <div className="flex flex-wrap gap-2">
            {persons.map((p) => {
              const on = picked.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                    on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface",
                  )}
                >
                  <input
                    type="checkbox"
                    name="personId"
                    value={p.id}
                    checked={on}
                    onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                    className="sr-only"
                  />
                  <span className="size-2.5 rounded-full" style={{ background: personColor(p.name.split(" ")[0]) }} />
                  {p.name.split(" ")[0]}
                  {on ? <Check className="size-4" /> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="personId" value={persons[0]?.id ?? ""} />
      )}
      {prods.length > 1 ? (
        <Field label="Which show">
          <Select name="productionId" defaultValue="">
            <option value="">All shows</option>
            {prods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="productionId" value="" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={allDay ? "From" : "Date"} className={allDay ? "" : "col-span-2"}>
          <Input type="date" name="date" min={today} defaultValue={prefill.date ?? today} required />
        </Field>
        {allDay ? (
          <Field label="Until (optional)">
            <Input type="date" name="untilDate" min={today} />
          </Field>
        ) : null}
      </div>
      <Checkbox name="allDay" label="All day (or several days)" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
      {!allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Can't be there from">
            <Input type="time" name="start" step={900} defaultValue={prefill.start ?? "18:00"} required />
          </Field>
          <Field label="Until">
            <Input type="time" name="end" step={900} defaultValue={prefill.end ?? "21:00"} required />
          </Field>
        </div>
      ) : null}
      <Field label="Note (optional)" hint="e.g. “Soccer game”, “Has to leave at 7:30”">
        <Input name="note" maxLength={500} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending || picked.length === 0}>
        {pending ? "Saving…" : picked.length > 1 ? `Tell the team (${picked.length} people)` : "Tell the team"}
      </Button>
    </form>
  );
}

export function DeleteConflictButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Remove this absence"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
      onClick={() => {
        if (!window.confirm("Remove this absence? The team will no longer see it when planning.")) return;
        start(async () => {
          await deleteConflict(id);
        });
      }}
    >
      <Trash className="size-4" />
    </button>
  );
}
