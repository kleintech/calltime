"use client";

import { ChevronDown } from "lucide-react";
import { startTransition, useActionState, useEffect, useState, type ReactNode } from "react";
import { Button, Checkbox, Field, Input, Notice, Textarea, cn } from "@/components/ui";
import { submitSignup, type PublicFormState } from "./actions";
import type { SlotOption } from "./slot-options";
import { ConflictPicker } from "./conflict-picker";

type Question = { id: string; label: string; type: "text" | "textarea" | "checkbox" };
export type GuardianPrefill = { lastName: string; guardianName: string; guardianEmail: string; guardianPhone: string };

function F({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Field
      label={label}
      hint={
        error ? (
          <span id={`${name}-error`} className="font-medium text-danger">
            {error}
          </span>
        ) : (
          hint
        )
      }
    >
      {children}
    </Field>
  );
}

function Section({ title, step, children }: { title: string; step?: number; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        {step ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{step}</span>
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}

const chip =
  "flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-base has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";

export function SignupForm({
  slug,
  slots: initialSlots,
  roles,
  questions,
  prefill,
  conflictGuide,
  conflictMin,
  conflictMax,
}: {
  slug: string;
  slots: SlotOption[];
  roles: { id: string; name: string }[];
  questions: Question[];
  prefill?: GuardianPrefill;
  /** e.g. "Rehearsals run Oct 19 – Nov 22" */
  conflictGuide?: string | null;
  conflictMin?: string;
  conflictMax?: string;
}) {
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitSignup, {});
  const slots = state.slots ?? initialSlots;
  const open = slots.filter((s) => s.remaining > 0);
  const [age, setAge] = useState("");
  const [picked, setPicked] = useState(open.length === 1 ? open[0].id : "");
  const slotId = open.some((s) => s.id === picked) ? picked : "";
  const minor = age !== "" && Number(age) < 18;
  const adult = age !== "" && Number(age) >= 18;
  const fe = state.fieldErrors ?? {};
  const days = [...new Set(slots.map((s) => s.day))];
  const chosen = slots.find((s) => s.id === slotId);
  const err = (name: string) => (fe[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  // After a failed submit, move focus to the first field that needs fixing.
  useEffect(() => {
    const first = Object.keys(state.fieldErrors ?? {})[0];
    if (!first) return;
    const el = document.querySelector<HTMLElement>(`[name="${first}"]`) ?? document.getElementById(`${first}-error`);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Submit via a transition without React's automatic form reset, so an error never wipes what was typed.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="slug" value={slug} />

      <Section title="Pick a time" step={1}>
        {open.length === 0 ? (
          <>
            <Notice tone="warn">Every audition time is full. Sign up anyway and the production team will be in touch about another time.</Notice>
            <input type="hidden" name="slotId" value="none" />
          </>
        ) : (
          <div className="space-y-4" role="radiogroup" aria-label="Audition time">
            {fe.slotId ? (
              <p id="slotId-error" tabIndex={-1} className="rounded-xl bg-danger-soft px-3 py-2 text-base font-medium text-danger">
                {fe.slotId}
              </p>
            ) : null}
            {days.map((day) => (
              <div key={day}>
                <p className="mb-2 text-sm font-semibold text-muted">{day}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {slots
                    .filter((s) => s.day === day)
                    .map((s) => {
                      const full = s.remaining === 0;
                      return (
                        <label
                          key={s.id}
                          className={cn(
                            "flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4 py-2 transition",
                            full
                              ? "cursor-not-allowed border-dashed border-line text-muted"
                              : slotId === s.id
                                ? "cursor-pointer border-accent bg-accent-soft ring-2 ring-accent/30"
                                : "cursor-pointer border-line hover:bg-surface-2",
                            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                          )}
                        >
                          <input
                            type="radio"
                            name="slotId"
                            value={s.id}
                            required
                            disabled={full}
                            className="sr-only"
                            checked={slotId === s.id}
                            onChange={() => setPicked(s.id)}
                          />
                          <span className="min-w-0">
                            <span className={cn("block text-base font-semibold tabular-nums", full && "line-through")}>{s.range}</span>
                            {s.label ? <span className="block truncate text-sm text-muted">{s.label}</span> : null}
                          </span>
                          <span className={cn("shrink-0 text-sm", full ? "font-medium" : "text-muted")}>
                            {full ? "Full" : s.remaining === 1 ? "1 spot left" : `${s.remaining} spots left`}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="About the performer" step={2}>
        <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
          <F label="First name" name="firstName" error={fe.firstName}>
            <Input name="firstName" required autoComplete="given-name" {...err("firstName")} />
          </F>
          <F label="Last name" name="lastName" error={fe.lastName}>
            <Input name="lastName" required autoComplete="family-name" defaultValue={prefill?.lastName} {...err("lastName")} />
          </F>
        </div>
        <F label="Age" name="age" error={fe.age}>
          <Input
            name="age"
            type="number"
            inputMode="numeric"
            min={3}
            max={120}
            required
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="w-28"
            {...err("age")}
          />
        </F>

        {minor ? (
          <div className="space-y-4 rounded-xl bg-surface-2/60 p-4">
            <p className="font-semibold">Parent or guardian</p>
            <F label="Parent/guardian name" name="guardianName" error={fe.guardianName}>
              <Input name="guardianName" required autoComplete="name" defaultValue={prefill?.guardianName} {...err("guardianName")} />
            </F>
            <F label="Parent/guardian email" name="guardianEmail" error={fe.guardianEmail} hint="We'll send audition updates here.">
              <Input
                name="guardianEmail"
                type="email"
                required
                autoComplete="email"
                defaultValue={prefill?.guardianEmail}
                {...err("guardianEmail")}
              />
            </F>
            <F label="Parent/guardian phone" name="guardianPhone" error={fe.guardianPhone} hint="Our contact on audition day.">
              <Input name="guardianPhone" type="tel" required autoComplete="tel" defaultValue={prefill?.guardianPhone} {...err("guardianPhone")} />
            </F>
            <F label="Performer's own email (optional)" name="email" error={fe.email} hint="Only if they have their own.">
              <Input name="email" type="email" autoComplete="off" {...err("email")} />
            </F>
          </div>
        ) : adult ? (
          <>
            <F label="Email" name="email" error={fe.email}>
              <Input name="email" type="email" required autoComplete="email" {...err("email")} />
            </F>
            <F label="Phone (optional)" name="phone" error={fe.phone}>
              <Input name="phone" type="tel" autoComplete="tel" />
            </F>
          </>
        ) : (
          <p className="text-sm text-muted">Enter the performer&apos;s age to continue. Under 18? We&apos;ll ask for a parent or guardian.</p>
        )}
      </Section>

      <Section title="Dates you can't make" step={3}>
        <p className="-mt-2 text-base text-muted">
          {conflictGuide ? `${conflictGuide}. ` : ""}Tell us any dates or times you already know you can&apos;t make, so we can plan around
          them. Weekly things (like practice every Tuesday) can repeat.
        </p>
        <ConflictPicker min={conflictMin} max={conflictMax} error={fe.conflictDates} />
      </Section>

      {questions.length ? (
        <Section title="A few questions from the director">
          {questions.map((q) =>
            q.type === "checkbox" ? (
              <Checkbox key={q.id} name={`q_${q.id}`} label={q.label} />
            ) : (
              <F key={q.id} name={`q_${q.id}`} label={`${q.label} (optional)`}>
                {q.type === "textarea" ? <Textarea name={`q_${q.id}`} rows={3} /> : <Input name={`q_${q.id}`} />}
              </F>
            ),
          )}
        </Section>
      ) : null}

      <details className="group rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,.04)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 text-base font-medium">
          Add roles &amp; experience (optional)
          <ChevronDown className="size-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-4 border-t border-line p-4">
          {roles.length ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Roles you&apos;re interested in</legend>
              <div className="flex flex-wrap gap-2">
                <label className={chip}>
                  <input type="checkbox" name="anyRole" className="sr-only" /> Any role
                </label>
                {roles.map((r) => (
                  <label key={r.id} className={chip}>
                    <input type="checkbox" name="roles" value={r.id} className="sr-only" /> {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <F label={roles.length ? "Anything else about roles? (optional)" : "Roles you're interested in (optional)"} name="otherRoles" error={fe.otherRoles}>
            <Input name="otherRoles" placeholder={roles.length ? "e.g. happy to do crew" : "e.g. Puck, any fairy"} />
          </F>
          <F label="Experience (optional)" name="experience" error={fe.experience}>
            <Textarea name="experience" rows={3} placeholder="Shows, classes, choir, dance…" />
          </F>
          <F label="Anything else about your availability? (optional)" name="conflictsText" error={fe.conflictsText}>
            <Textarea name="conflictsText" rows={3} placeholder="e.g. might have a school concert in November, date TBD" />
          </F>
        </div>
      </details>

      {state.error ? (
        <div role="alert">
          <Notice tone="danger">{state.error}</Notice>
        </div>
      ) : null}
      <Button type="submit" className="min-h-14 w-full text-base" disabled={pending}>
        {pending ? "Signing up…" : chosen ? `Sign up for ${chosen.short}` : "Sign up to audition"}
      </Button>
      <p className="text-center text-sm text-muted">No account needed. Your details are only shared with the production team.</p>
    </form>
  );
}
