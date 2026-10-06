"use client";

import { Plus, Printer, Trash2 } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "@/components/toast";
import { Button, Checkbox, Field, Input, Notice, Select, Textarea, cn } from "@/components/ui";
import type { FormState } from "../actions";

/** Pending flag for StateForm, which dispatches via a transition (useFormStatus doesn't see those). */
const PendingContext = createContext(false);

/** Submit button that shows a pending label while its form is submitting. */
export function SubmitButton({ children, pendingLabel, ...props }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const ctxPending = useContext(PendingContext);
  const pending = status.pending || ctxPending;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}

/** Submit button that asks for confirmation first. */
export function ConfirmButton({ message, ...props }: ComponentProps<typeof Button> & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    />
  );
}

/** A form bound to a (state, formData) server action, rendering its error / ok notice. */
export function StateForm({
  action,
  children,
  className,
  hidden,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) toast(state.ok, { tone: "success" });
  }, [state]);
  return (
    <PendingContext value={pending}>
      <form
        action={formAction}
        onSubmit={(e) => {
          // Run the action without React's automatic form reset so inputs keep their values (errors and edits).
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
        className={cn("space-y-4", className)}
      >
        {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {children}
      </form>
    </PendingContext>
  );
}

type Question = { id: string; label: string; type: "text" | "textarea" | "checkbox" };

/** Build the extra signup questions; serialized into a hidden `questions` JSON input. */
export function QuestionsBuilder({ initial }: { initial: Question[] }) {
  const [qs, setQs] = useState<Question[]>(initial);
  const update = (i: number, patch: Partial<Question>) => setQs((cur) => cur.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="questions" value={JSON.stringify(qs.filter((q) => q.label.trim()))} />
      {qs.length === 0 ? (
        <p className="text-sm text-muted">No extra questions. Name, contact, age, guardian, experience and conflicts are always asked.</p>
      ) : null}
      {qs.map((q, i) => (
        <div key={q.id} className="space-y-2 rounded-xl border border-line bg-surface-2/50 p-3">
          <Input
            value={q.label}
            placeholder="Question, e.g. “What song will you sing?”"
            onChange={(e) => update(i, { label: e.target.value })}
            aria-label={`Question ${i + 1}`}
          />
          <div className="flex gap-2">
            <Select value={q.type} onChange={(e) => update(i, { type: e.target.value as Question["type"] })} aria-label="Answer type">
              <option value="text">Short answer</option>
              <option value="textarea">Paragraph</option>
              <option value="checkbox">Checkbox (yes/no)</option>
            </Select>
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove question"
              onClick={() => setQs((cur) => cur.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setQs((cur) => [...cur, { id: `q${Date.now().toString(36)}`, label: "", type: "text" }])}
      >
        <Plus className="size-4" /> Add question
      </Button>
    </div>
  );
}

/** Create / edit an audition event. */
export function AuditionForm({
  action,
  hidden,
  initial,
  submitLabel,
  showSlug,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  initial?: { title: string; description: string | null; location: string | null; isOpen: boolean; questions: Question[]; slug: string };
  submitLabel: string;
  showSlug?: boolean;
}) {
  return (
    <StateForm action={action} hidden={hidden}>
      <Field label="Title">
        <Input name="title" required defaultValue={initial?.title ?? "Auditions"} placeholder="Spring Musical Auditions" />
      </Field>
      <Field label="What to prepare" hint="Shown on the public signup page: songs, monologues, what to wear, ages.">
        <Textarea
          name="description"
          rows={4}
          defaultValue={initial?.description ?? ""}
          placeholder="Prepare 16 bars of a musical theatre song…"
        />
      </Field>
      <Field label="Location">
        <Input name="location" defaultValue={initial?.location ?? ""} placeholder="Rehearsal Hall, Room A" />
      </Field>
      {showSlug ? (
        <Field label="Public link" hint="Letters, numbers and dashes.">
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-sm text-muted">/audition/</span>
            <Input name="slug" defaultValue={initial?.slug ?? ""} pattern="[a-z0-9\-]+" />
          </div>
        </Field>
      ) : null}
      <Checkbox name="isOpen" label="Open for signups" defaultChecked={initial?.isOpen ?? true} />
      <div className="space-y-2">
        <span className="text-sm font-medium">Extra questions</span>
        <QuestionsBuilder initial={initial?.questions ?? []} />
      </div>
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </StateForm>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </Button>
  );
}
