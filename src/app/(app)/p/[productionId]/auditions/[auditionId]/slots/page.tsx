import { and, eq, ne } from "drizzle-orm";
import { Plus, Wand2 } from "lucide-react";
import { db } from "@/db";
import { auditionSignups } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { fullName, getAuditionForProduction, getSlotsWithCounts, type SlotWithCount } from "@/lib/auditions";
import { dayKey, fmtDayLong, fmtRange, toDateInput, toTimeInput } from "@/lib/time";
import { Badge, EmptyState, Field, Input, Select, SectionTitle, cn } from "@/components/ui";
import { addSlot, deleteSlot, generateSlots, updateSlot } from "../../actions";
import { ConfirmButton, StateForm, SubmitButton } from "../../_components/forms";

function SlotFields({ slot, tz, defaultDate }: { slot?: SlotWithCount; tz: string; defaultDate: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" className="col-span-2 sm:col-span-1">
          <Input type="date" name="date" required defaultValue={slot ? toDateInput(slot.startsAt, tz) : defaultDate} />
        </Field>
        <Field label="Kind" className="col-span-2 sm:col-span-1">
          <Select name="kind" defaultValue={slot?.kind ?? "audition"}>
            <option value="audition">Audition</option>
            <option value="callback">Callback</option>
          </Select>
        </Field>
        <Field label="Start">
          <Input type="time" name="start" required defaultValue={slot ? toTimeInput(slot.startsAt, tz) : "10:00"} />
        </Field>
        <Field label="End">
          <Input type="time" name="end" required defaultValue={slot ? toTimeInput(slot.endsAt, tz) : "10:15"} />
        </Field>
        <Field label="Capacity">
          <Input type="number" name="capacity" min={1} max={500} required defaultValue={slot?.capacity ?? 1} inputMode="numeric" />
        </Field>
        <Field label="Label (optional)">
          <Input name="label" defaultValue={slot?.label ?? ""} placeholder="Dance call" />
        </Field>
      </div>
      <Field label="Location (optional)" hint="Leave blank to use the audition's location.">
        <Input name="location" defaultValue={slot?.location ?? ""} />
      </Field>
    </>
  );
}

export default async function SlotsPage({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]/slots">) {
  const { productionId, auditionId } = await params;
  const { org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  await getAuditionForProduction(productionId, auditionId);
  const slots = await getSlotsWithCounts(auditionId);
  const signups = await db
    .select({ id: auditionSignups.id, firstName: auditionSignups.firstName, lastName: auditionSignups.lastName, slotId: auditionSignups.slotId, callbackSlotId: auditionSignups.callbackSlotId })
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), ne(auditionSignups.status, "withdrawn")));
  const namesBySlot = new Map<string, string[]>();
  for (const s of signups) {
    for (const id of [s.slotId, s.callbackSlotId]) {
      if (!id) continue;
      namesBySlot.set(id, [...(namesBySlot.get(id) ?? []), fullName(s)]);
    }
  }
  const byDay = new Map<string, SlotWithCount[]>();
  for (const s of slots) {
    const k = dayKey(s.startsAt, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const hidden = { productionId, auditionId };
  const today = toDateInput(new Date(), tz);

  return (
    <div>
      <details className="rounded-2xl border border-line bg-surface" open={slots.length === 0}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 font-medium">
          <Wand2 className="size-4 text-accent" /> Generate a block of slots
        </summary>
        <div className="border-t border-line p-4">
          <StateForm action={generateSlots} hidden={hidden}>
            <p className="text-sm text-muted">e.g. Saturday 10:00–12:00 in 15-minute slots, 2 people each.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" className="col-span-2 sm:col-span-1">
                <Input type="date" name="date" required defaultValue={today} />
              </Field>
              <Field label="Kind" className="col-span-2 sm:col-span-1">
                <Select name="kind" defaultValue="audition">
                  <option value="audition">Audition</option>
                  <option value="callback">Callback</option>
                </Select>
              </Field>
              <Field label="From">
                <Input type="time" name="start" required defaultValue="10:00" />
              </Field>
              <Field label="Until">
                <Input type="time" name="end" required defaultValue="12:00" />
              </Field>
              <Field label="Minutes each">
                <Input type="number" name="length" min={5} max={480} step={5} required defaultValue={15} inputMode="numeric" />
              </Field>
              <Field label="People per slot">
                <Input type="number" name="capacity" min={1} max={500} required defaultValue={2} inputMode="numeric" />
              </Field>
            </div>
            <Field label="Label (optional)">
              <Input name="label" placeholder="Vocal auditions" />
            </Field>
            <SubmitButton className="w-full sm:w-auto" pendingLabel="Generating…">
              Generate slots
            </SubmitButton>
          </StateForm>
        </div>
      </details>

      <details className="mt-3 rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 font-medium">
          <Plus className="size-4 text-accent" /> Add a single slot
        </summary>
        <div className="border-t border-line p-4">
          <StateForm action={addSlot} hidden={hidden}>
            <SlotFields tz={tz} defaultDate={today} />
            <SubmitButton className="w-full sm:w-auto">Add slot</SubmitButton>
          </StateForm>
        </div>
      </details>

      {slots.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No slots yet" body="Generate a block above. Auditioners can only sign up once there are open audition slots." />
        </div>
      ) : (
        [...byDay.entries()].map(([k, daySlots]) => (
          <section key={k}>
            <SectionTitle>
              {fmtDayLong(daySlots[0].startsAt, tz)} · {daySlots.reduce((a, s) => a + s.filled, 0)}/{daySlots.reduce((a, s) => a + s.capacity, 0)}
            </SectionTitle>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {daySlots.map((s) => {
                const names = namesBySlot.get(s.id) ?? [];
                const pct = Math.min(100, Math.round((s.filled / s.capacity) * 100));
                return (
                  <details key={s.id} className="group">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium tabular-nums">{fmtRange(s.startsAt, s.endsAt, tz)}</span>
                          {s.kind === "callback" ? <Badge tone="gold">Callback</Badge> : null}
                          {s.label ? <span className="truncate text-sm text-muted">{s.label}</span> : null}
                        </div>
                        <div className="truncate text-sm text-muted">{names.length ? names.join(", ") : "Empty"}</div>
                      </div>
                      <div className="w-16 shrink-0 text-right">
                        <div className={cn("text-sm font-semibold tabular-nums", s.filled >= s.capacity ? "text-success" : "text-ink")}>
                          {s.filled}/{s.capacity}
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className={cn("h-full rounded-full", s.filled > s.capacity ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </summary>
                    <div className="space-y-4 border-t border-line bg-surface-2/40 p-4">
                      <StateForm action={updateSlot} hidden={{ ...hidden, slotId: s.id }}>
                        <SlotFields slot={s} tz={tz} defaultDate={today} />
                        <SubmitButton variant="secondary">Save slot</SubmitButton>
                      </StateForm>
                      <form action={deleteSlot}>
                        <input type="hidden" name="productionId" value={productionId} />
                        <input type="hidden" name="auditionId" value={auditionId} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <ConfirmButton
                          variant="danger"
                          message={names.length ? `${names.length} people are booked in this slot. They'll be left without a slot. Delete anyway?` : "Delete this slot?"}
                        >
                          Delete slot
                        </ConfirmButton>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
