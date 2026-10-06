"use client";

import { CalendarX2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, Input, cn } from "@/components/ui";

export type ConflictRow = { date: string; allDay: boolean; start?: string; end?: string; weekly?: boolean; note?: string };
type Row = ConflictRow & { key: number };

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, date: "", allDay: true, start: "15:00", end: "17:00", weekly: false, note: "" });

/**
 * Phone-friendly list of "dates I can't make". Serialized into a hidden `conflictDates` JSON input,
 * so it works inside any form. Times are wall-clock in the org's timezone.
 */
export function ConflictPicker({
  initial = [],
  min,
  max,
  error,
}: {
  initial?: ConflictRow[];
  /** yyyy-MM-dd bounds for the date inputs (e.g. today … closing night). */
  min?: string;
  max?: string;
  error?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((r) => ({ ...blank(), ...r, key: nextKey++ })));
  const update = (key: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const serialized = rows
    .filter((r) => r.date)
    .map(({ date, allDay, start, end, weekly, note }) => (allDay ? { date, allDay, weekly, note } : { date, allDay, start, end, weekly, note }));

  return (
    <div className="space-y-3">
      <input type="hidden" name="conflictDates" value={JSON.stringify(serialized)} />
      {error ? (
        <p id="conflictDates-error" tabIndex={-1} className="rounded-xl bg-danger-soft px-3 py-2 text-base font-medium text-danger">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 text-base text-muted">
          <CalendarX2 className="size-5 shrink-0" aria-hidden /> No conflicts added.
        </p>
      ) : null}
      {rows.map((r, i) => (
        <fieldset key={r.key} className="space-y-3 rounded-xl border border-line bg-surface-2/50 p-3">
          <legend className="sr-only">Conflict {i + 1}</legend>
          <div className="flex items-end gap-2">
            <label className="block min-w-0 flex-1 space-y-1.5">
              <span className="text-sm font-medium">Date</span>
              <Input type="date" value={r.date} min={min} max={max} onChange={(e) => update(r.key, { date: e.target.value })} required />
            </label>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove conflict ${i + 1}`}
              className="px-3"
              onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
            >
              <Trash2 className="size-5" aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-6">
            <Checkbox label="All day" checked={r.allDay} onChange={(e) => update(r.key, { allDay: e.target.checked })} />
            <Checkbox label="Every week" checked={!!r.weekly} onChange={(e) => update(r.key, { weekly: e.target.checked })} />
          </div>
          {!r.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">From</span>
                <Input type="time" step={900} value={r.start ?? ""} onChange={(e) => update(r.key, { start: e.target.value })} required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Until</span>
                <Input type="time" step={900} value={r.end ?? ""} onChange={(e) => update(r.key, { end: e.target.value })} required />
              </label>
            </div>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Reason (optional)</span>
            <Input value={r.note ?? ""} maxLength={200} placeholder="Soccer, family trip…" onChange={(e) => update(r.key, { note: e.target.value })} />
          </label>
        </fieldset>
      ))}
      <Button type="button" variant="secondary" className={cn(rows.length === 0 && "w-full sm:w-auto")} onClick={() => setRows((cur) => [...cur, blank()])}>
        <Plus className="size-4" aria-hidden /> {rows.length ? "Add another date" : "Add a date you can't make"}
      </Button>
    </div>
  );
}
