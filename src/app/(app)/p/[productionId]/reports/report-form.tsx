"use client";

import { ChevronDown } from "lucide-react";
import { startTransition, useActionState } from "react";
import { Button, Notice, Textarea } from "@/components/ui";
import { saveReport, type ReportState } from "./actions";

type Dept = { key: string; label: string };

export function ReportForm({
  productionId,
  eventId,
  summary,
  scenes,
  covered,
  departments,
  notes,
  published,
}: {
  productionId: string;
  eventId: string;
  summary: string;
  scenes: { id: string; label: string }[];
  covered: string[];
  departments: readonly Dept[];
  notes: Record<string, string | undefined>;
  published: boolean;
}) {
  const [state, action, pending] = useActionState<ReportState, FormData>(saveReport, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Keep typed text (no auto reset) and include which button was pressed.
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(fd));
      }}
      className="space-y-5"
    >
      <input type="hidden" name="productionId" value={productionId} />
      <input type="hidden" name="eventId" value={eventId} />

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Summary</span>
        <Textarea
          name="summary"
          rows={5}
          defaultValue={summary}
          placeholder="Ran Act 1 Sc 1–3. Started 10 min late. Choreo for 'With Catlike Tread' set through the second chorus…"
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Scenes covered</legend>
        {scenes.length === 0 ? (
          <p className="text-sm text-muted">No scenes in this production yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {scenes.map((s) => (
              <label
                key={s.id}
                className="flex min-h-10 cursor-pointer items-center rounded-full border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              >
                <input type="checkbox" name="scenesCovered" value={s.id} defaultChecked={covered.includes(s.id)} className="sr-only" />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium">Department notes</p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {departments.map((d) => (
            <details key={d.key} className="group" open={!!notes[d.key]}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium">
                <span>
                  {d.label}
                  {notes[d.key] ? <span className="ml-2 text-xs text-accent">has notes</span> : null}
                </span>
                <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-4 pb-4">
                <Textarea name={`dept_${d.key}`} rows={3} defaultValue={notes[d.key] ?? ""} aria-label={`${d.label} notes`} placeholder="No notes" />
              </div>
            </details>
          ))}
        </div>
      </div>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok && !pending ? <Notice tone="success">{state.ok}</Notice> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {published ? (
          <>
            <Button type="submit" name="intent" value="save" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button type="submit" name="intent" value="unpublish" variant="ghost" disabled={pending}>
              Unpublish
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="intent" value="publish" disabled={pending}>
              {pending ? "Saving…" : "Publish to creative team"}
            </Button>
            <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
              Save draft
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
