import { HandHeart, Mail, Phone, Download } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, EmptyState, Field, Input, Notice, SectionTitle, Select, Stat, Textarea, buttonClass, cn } from "@/components/ui";
import { requireProductionAccess } from "@/lib/access";
import type { ReactNode } from "react";
import { toDateInput, toTimeInput } from "@/lib/time";
import {
  fmtHours,
  fmtWhen,
  getHoursByUser,
  getMySignups,
  getProductionFamilies,
  getShiftsWithSignups,
  getVolunteerSettings,
  isUpcoming,
  shiftMinutes,
  type Shift,
} from "@/lib/volunteers";
import { ActionForm, SubmitButton } from "@/app/(app)/org/_components/action-form";
import { Disclosure } from "@/app/(app)/org/_components/disclosure";
import { createShift, deleteShift, quickCreateShifts, removeSignup, saveVolunteerSettings, updateShift } from "./actions";
import { SignupButton } from "./signup-button";

export const metadata = { title: "Volunteers" };

export default async function VolunteersPage({ params }: PageProps<"/p/[productionId]/volunteers">) {
  const { productionId } = await params;
  const ctx = await requireProductionAccess(productionId);
  return ctx.canEdit ? <EditorView ctx={ctx} /> : <FamilyView ctx={ctx} />;
}

type Ctx = Awaited<ReturnType<typeof requireProductionAccess>>;

/* ───────────────────────── Families ───────────────────────── */

async function FamilyView({ ctx }: { ctx: Ctx }) {
  const { production, org, user } = ctx;
  const tz = org.timezone;
  const [shifts, mine, settings, hours] = await Promise.all([
    getShiftsWithSignups(production.id),
    getMySignups(user.id, production.id),
    getVolunteerSettings(production.id),
    getHoursByUser(production.id),
  ]);
  const mineIds = new Set(mine.map((m) => m.shift.id));
  const open = shifts.filter((s) => isUpcoming(s.shift) && !mineIds.has(s.shift.id));
  const myMinutes = hours.get(user.id) ?? 0;
  const required = settings.requiredHours;

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={<HandHeart />}
        title="No volunteer shifts yet"
        body={`When the creative team for ${production.title} needs helpers — concessions, costumes, snacks — the shifts show up here and you can sign up in one tap.`}
      />
    );
  }

  return (
    <div>
      <p className="mb-4 text-base text-muted">It takes a village to put on a show. Pick a shift that works for your family.</p>

      {required ? (
        <Card className="mb-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">Your volunteer hours</p>
            <p className="tabular text-sm text-muted">
              {fmtHours(myMinutes)} of {required} hrs
            </p>
          </div>
          <Progress value={myMinutes} max={required * 60} />
          <p className="mt-2 text-sm text-muted">
            {myMinutes >= required * 60
              ? "You've signed up for all your hours — thank you!"
              : `Each family is asked to help ${required} hours for this show.`}
          </p>
        </Card>
      ) : null}

      <SectionTitle>My volunteer shifts</SectionTitle>
      {mine.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-base text-muted">
          You haven&apos;t signed up for anything yet.
        </p>
      ) : (
        <div className="space-y-3">
          {mine.map(({ shift }) => (
            <Card key={shift.id} className="space-y-3">
              <ShiftHeader shift={shift} tz={tz} right={<Badge tone="success">You&apos;re helping</Badge>} />
              {isUpcoming(shift) ? <SignupButton shiftId={shift.id} mode="cancel" title={shift.title} /> : <Badge>Done</Badge>}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Open shifts</SectionTitle>
      {open.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-base text-muted">
          Nothing else open right now. Check back closer to the show.
        </p>
      ) : (
        <div className="space-y-3">
          {open.map(({ shift, spotsLeft }) => (
            <Card key={shift.id} className={cn("space-y-3", spotsLeft === 0 && "opacity-70")}>
              <ShiftHeader
                shift={shift}
                tz={tz}
                right={
                  spotsLeft === 0 ? (
                    <Badge>Full</Badge>
                  ) : (
                    <Badge tone={spotsLeft <= 1 ? "warn" : "gold"}>
                      {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                    </Badge>
                  )
                }
              />
              {shift.description ? <p className="text-base text-muted">{shift.description}</p> : null}
              {spotsLeft > 0 ? <SignupButton shiftId={shift.id} mode="join" title={shift.title} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftHeader({ shift, tz, right }: { shift: Shift; tz: string; right?: ReactNode }) {
  const mins = shiftMinutes(shift);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-snug">{shift.title}</h3>
        <p className="text-base text-ink">{fmtWhen(shift, tz)}</p>
        <p className="text-sm text-muted">
          {[shift.location, mins ? `${fmtHours(mins)} credit` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-gold")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ───────────────────────── Editors ───────────────────────── */

function ShiftFields({ shift, tz, defaultLocation }: { shift?: Shift; tz: string; defaultLocation?: string | null }) {
  return (
    <>
      <Field label="What's the job?">
        <Input name="title" required defaultValue={shift?.title} placeholder="Concessions — Opening Night" autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" optional hint="Leave empty for an ongoing role.">
          <Input name="date" type="date" defaultValue={shift?.startsAt ? toDateInput(shift.startsAt, tz) : ""} />
        </Field>
        <Field label="Starts" optional>
          <Input name="start" type="time" defaultValue={shift?.startsAt ? toTimeInput(shift.startsAt, tz) : ""} />
        </Field>
        <Field label="Ends" optional>
          <Input name="end" type="time" defaultValue={shift?.endsAt ? toTimeInput(shift.endsAt, tz) : ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Spots">
          <Input name="capacity" type="number" inputMode="numeric" min={1} max={500} required defaultValue={shift?.capacity ?? 2} />
        </Field>
        <Field label="Hours credit" optional hint="Defaults to the shift length.">
          <Input
            name="creditHours"
            type="number"
            inputMode="decimal"
            step="0.5"
            min={0}
            defaultValue={shift?.creditMinutes != null ? shift.creditMinutes / 60 : ""}
          />
        </Field>
        <Field label="Where" optional>
          <Input name="location" defaultValue={shift?.location ?? defaultLocation ?? ""} autoComplete="off" />
        </Field>
      </div>
      <Field label="Details" optional hint="What to bring, who to find when you arrive.">
        <Textarea name="description" defaultValue={shift?.description ?? ""} />
      </Field>
    </>
  );
}

async function EditorView({ ctx }: { ctx: Ctx }) {
  const { production, org } = ctx;
  const tz = org.timezone;
  const [shifts, settings, families, hours] = await Promise.all([
    getShiftsWithSignups(production.id),
    getVolunteerSettings(production.id),
    getProductionFamilies(production.id),
    getHoursByUser(production.id),
  ]);
  const upcoming = shifts.filter((s) => isUpcoming(s.shift));
  const past = shifts.filter((s) => !isUpcoming(s.shift));
  const spots = shifts.reduce((n, s) => n + s.shift.capacity, 0);
  const filled = shifts.reduce((n, s) => n + Math.min(s.signups.length, s.shift.capacity), 0);
  const helpingIds = new Set(shifts.flatMap((s) => s.signups.map((x) => x.userId)));
  const helpingFamilies = families.filter((f) => helpingIds.has(f.userId)).length;
  const required = settings.requiredHours;

  const listText = shifts
    .map(({ shift, signups }) =>
      [
        `${shift.title} — ${fmtWhen(shift, tz)} (${signups.length}/${shift.capacity})`,
        ...signups.map((s) => `  • ${s.name}${s.forName ? ` (${s.forName})` : ""} — ${s.email}${s.phone ? `, ${s.phone}` : ""}`),
      ].join("\n"),
    )
    .join("\n\n");
  const emails = [...new Set(shifts.flatMap((s) => s.signups.map((x) => x.email)))].join(", ");

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Shifts" value={upcoming.length} hint={past.length ? `${past.length} past` : undefined} />
        <Stat label="Spots filled" value={`${filled}/${spots}`} tone={filled < spots ? "warn" : "success"} />
        <Stat label="Families helping" value={families.length ? `${helpingFamilies}/${families.length}` : helpingFamilies} />
      </div>

      <SectionTitle>Add shifts</SectionTitle>
      <div className="space-y-3">
        <Disclosure className="rounded-2xl border border-line bg-surface" defaultOpen={shifts.length === 0}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-semibold">+ Add several at once</summary>
          <div className="border-t border-line p-4">
            <ActionForm action={quickCreateShifts} submitLabel="Add shifts" pendingLabel="Adding…" resetOnSuccess>
              <input type="hidden" name="productionId" value={production.id} />
              <Field label="One job per line" hint="Add “x3” at the end of a line for 3 spots.">
                <Textarea name="titles" required className="min-h-32" placeholder={"Concessions x3\nUshers x4\nBackstage snack table x2\nCostume crew"} />
              </Field>
              <Field label="When">
                <Select name="mode" defaultValue="performances">
                  <option value="performances">One of each for every performance</option>
                  <option value="time">All at the date and time below</option>
                  <option value="ongoing">Ongoing roles (no set time)</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date" optional>
                  <Input name="date" type="date" />
                </Field>
                <Field label="Starts" optional>
                  <Input name="start" type="time" />
                </Field>
                <Field label="Ends" optional>
                  <Input name="end" type="time" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Spots per job" hint="Unless the line says otherwise.">
                  <Input name="capacity" type="number" inputMode="numeric" min={1} defaultValue={2} />
                </Field>
                <Field label="Where" optional>
                  <Input name="location" defaultValue={production.venue ?? ""} />
                </Field>
              </div>
            </ActionForm>
          </div>
        </Disclosure>
        <details className="rounded-2xl border border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-semibold">+ Add one shift</summary>
          <div className="border-t border-line p-4">
            <ActionForm action={createShift} submitLabel="Add shift" pendingLabel="Adding…" resetOnSuccess>
              <input type="hidden" name="productionId" value={production.id} />
              <ShiftFields tz={tz} defaultLocation={production.venue} />
            </ActionForm>
          </div>
        </details>
      </div>

      <SectionTitle
        action={
          shifts.some((s) => s.signups.length) ? (
            <div className="flex flex-wrap gap-2">
              <CopyButton value={listText} label="Copy list" />
            </div>
          ) : null
        }
      >
        Shifts
      </SectionTitle>
      {shifts.length === 0 ? (
        <EmptyState
          icon={<HandHeart />}
          title="No shifts yet"
          body="List the jobs parents can help with — concessions, ushers, costumes, snacks — and families sign up in one tap."
        />
      ) : (
        <div className="space-y-3">
          {upcoming.map((s) => (
            <EditorShiftCard key={s.shift.id} {...s} tz={tz} />
          ))}
          {past.length ? (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted">Past shifts ({past.length})</summary>
              <div className="mt-2 space-y-3">
                {past.map((s) => (
                  <EditorShiftCard key={s.shift.id} {...s} tz={tz} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}

      {shifts.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`/p/${production.id}/volunteers/export.csv`} className={buttonClass("secondary")}>
            <Download /> Download spreadsheet (CSV)
          </a>
          {emails ? <CopyButton value={emails} label="Copy volunteer emails" /> : null}
        </div>
      ) : null}

      <SectionTitle>Family hours</SectionTitle>
      <Card>
        <ActionForm action={saveVolunteerSettings} submitLabel="Save requirement">
          <input type="hidden" name="productionId" value={production.id} />
          <Field label="Hours asked of each family" optional hint="Leave empty for no requirement. Families see their progress.">
            <Input name="requiredHours" type="number" inputMode="numeric" min={0} defaultValue={required ?? ""} className="max-w-32" />
          </Field>
        </ActionForm>
      </Card>
      {families.length ? (
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {[...families]
            .map((f) => ({ ...f, minutes: hours.get(f.userId) ?? 0 }))
            .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name))
            .map((f) => (
              <div key={f.userId} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="truncate text-sm text-muted">For {f.covers.join(", ")}</div>
                  </div>
                  <span className={cn("tabular shrink-0 text-sm", f.minutes === 0 ? "text-warn" : "text-muted")}>
                    {f.minutes === 0 ? "No shifts yet" : fmtHours(f.minutes)}
                    {required ? ` / ${required}` : ""}
                  </span>
                </div>
                {required ? <Progress value={f.minutes} max={required * 60} /> : null}
              </div>
            ))}
        </div>
      ) : (
        <Notice className="mt-3">Families appear here once cast members (or their guardians) have accounts.</Notice>
      )}
    </div>
  );
}

function EditorShiftCard({
  shift,
  signups,
  spotsLeft,
  tz,
}: Awaited<ReturnType<typeof getShiftsWithSignups>>[number] & { tz: string }) {
  return (
    <Card className="space-y-3">
      <ShiftHeader
        shift={shift}
        tz={tz}
        right={
          spotsLeft === 0 ? (
            <Badge tone="success">Full</Badge>
          ) : (
            <Badge tone="warn">
              Needs {spotsLeft}
            </Badge>
          )
        }
      />
      <div>
        <div className="flex justify-between text-sm text-muted">
          <span>
            {signups.length} of {shift.capacity} signed up
          </span>
        </div>
        <Progress value={signups.length} max={shift.capacity} />
      </div>
      {signups.length ? (
        <ul className="divide-y divide-line rounded-xl bg-surface-2">
          {signups.map((s) => (
            <li key={s.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.name}
                  {s.forName && s.forName !== s.name ? <span className="font-normal text-muted"> · {s.forName}</span> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 text-sm">
                  <a href={`mailto:${s.email}`} className="inline-flex min-h-8 items-center gap-1 text-accent">
                    <Mail className="size-3.5" /> {s.email}
                  </a>
                  {s.phone ? (
                    <a href={`tel:${s.phone}`} className="inline-flex min-h-8 items-center gap-1 text-accent">
                      <Phone className="size-3.5" /> {s.phone}
                    </a>
                  ) : null}
                </div>
                {s.note ? <p className="text-sm text-muted">“{s.note}”</p> : null}
              </div>
              <form action={removeSignup}>
                <input type="hidden" name="shiftId" value={shift.id} />
                <input type="hidden" name="userId" value={s.userId} />
                <SubmitButton variant="ghost" confirm={`Take ${s.name} off “${shift.title}”?`} className="text-sm">
                  Remove
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-accent">Edit shift</summary>
        <div className="mt-2 space-y-4">
          <ActionForm action={updateShift} submitLabel="Save shift">
            <input type="hidden" name="shiftId" value={shift.id} />
            <ShiftFields shift={shift} tz={tz} />
          </ActionForm>
          <form action={deleteShift}>
            <input type="hidden" name="shiftId" value={shift.id} />
            <SubmitButton
              variant="danger"
              confirm={
                signups.length
                  ? `Delete “${shift.title}”? ${signups.length} volunteer${signups.length === 1 ? " is" : "s are"} signed up and will lose the spot.`
                  : `Delete “${shift.title}”?`
              }
            >
              Delete shift
            </SubmitButton>
          </form>
        </div>
      </details>
    </Card>
  );
}
