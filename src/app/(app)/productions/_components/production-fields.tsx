import type { productions } from "@/db/schema";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { ColorPicker } from "./color-picker";
import { STATUS_OPTIONS } from "./constants";

/** Shared fields for creating / editing a production. */
export function ProductionFields({
  p,
  collapseDetails = false,
}: {
  p?: Partial<typeof productions.$inferSelect>;
  /** New-production form: only the title up front, the rest tucked under "More details". */
  collapseDetails?: boolean;
}) {
  const title = (
    <Field label="Title">
      <Input name="title" required maxLength={200} defaultValue={p?.title ?? ""} placeholder="The Pirates of Penzance" />
    </Field>
  );
  const details = <Details p={p} />;
  if (collapseDetails) {
    return (
      <>
        {title}
        <details className="group rounded-xl border border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold text-accent">
            More details (optional)
          </summary>
          <div className="space-y-4 border-t border-line p-3">
            <p className="text-sm text-muted">Dates, places, status and color. You can change all of these later in Settings.</p>
            {details}
          </div>
        </details>
      </>
    );
  }
  return (
    <>
      {title}
      {details}
    </>
  );
}

function Details({ p }: { p?: Partial<typeof productions.$inferSelect> }) {
  return (
    <>
      <Field label="Subtitle (optional)" hint="e.g. “Spring Musical 2027”">
        <Input name="subtitle" maxLength={200} defaultValue={p?.subtitle ?? ""} />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" maxLength={4000} defaultValue={p?.description ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Performance venue">
          <Input name="venue" maxLength={200} defaultValue={p?.venue ?? ""} />
        </Field>
        <Field label="Default rehearsal location">
          <Input name="defaultLocation" maxLength={200} defaultValue={p?.defaultLocation ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First rehearsal">
          <Input type="date" name="firstRehearsal" defaultValue={p?.firstRehearsal ?? ""} />
        </Field>
        <Field label="Opening">
          <Input type="date" name="openingDate" defaultValue={p?.openingDate ?? ""} />
        </Field>
        <Field label="Closing">
          <Input type="date" name="closingDate" defaultValue={p?.closingDate ?? ""} />
        </Field>
      </div>
      <Field label="Status">
        <Select name="status" defaultValue={p?.status ?? "planning"}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Accent color</span>
        <ColorPicker name="accentColor" defaultValue={p?.accentColor ?? "#7c3aed"} />
      </div>
    </>
  );
}
