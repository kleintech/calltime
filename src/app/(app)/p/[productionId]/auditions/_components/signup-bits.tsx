import { CalendarX2, Star, TriangleAlert } from "lucide-react";
import { clashes, fmtConflict, STATUS_LABEL, STATUS_TONE, type AuditionConflict, type SignupStatus } from "@/lib/auditions";
import { Badge, buttonClass, cn } from "@/components/ui";
import { setRating, setSignupStatus } from "../actions";

export function StatusBadge({ status }: { status: SignupStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Read-only star display. */
export function Stars({ rating, className }: { rating: number | null; className?: string }) {
  if (!rating) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-gold", className)} aria-label={`${rating} of 5`}>
      {Array.from({ length: rating }, (_, i) => (
        <Star key={i} className="size-3.5 fill-current" />
      ))}
    </span>
  );
}

type Ids = { productionId: string; auditionId: string; signupId: string };

function Hidden({ ids }: { ids: Ids }) {
  return (
    <>
      <input type="hidden" name="productionId" value={ids.productionId} />
      <input type="hidden" name="auditionId" value={ids.auditionId} />
      <input type="hidden" name="signupId" value={ids.signupId} />
    </>
  );
}

/** 1–5 tappable stars; tapping the current rating clears it. */
export function RatingInput({ ids, rating }: { ids: Ids; rating: number | null }) {
  return (
    <form action={setRating} className="flex items-center gap-1">
      <Hidden ids={ids} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="submit"
          name="rating"
          value={n}
          aria-label={`Rate ${n}`}
          className="flex size-11 items-center justify-center rounded-lg hover:bg-surface-2"
        >
          <Star className={cn("size-6", rating && n <= rating ? "fill-gold text-gold" : "text-line")} />
        </button>
      ))}
    </form>
  );
}

const PIPELINE: { status: SignupStatus; label: string }[] = [
  { status: "checked_in", label: "Check in" },
  { status: "auditioned", label: "Auditioned" },
  { status: "callback", label: "Callback" },
  { status: "not_cast", label: "Not cast" },
  { status: "withdrawn", label: "Withdrawn" },
];

/** Status pipeline buttons; the current status is highlighted. */
export function StatusButtons({ ids, status, compact }: { ids: Ids; status: SignupStatus; compact?: boolean }) {
  const items = status === "registered" ? PIPELINE : [{ status: "registered" as const, label: "Registered" }, ...PIPELINE];
  return (
    <form action={setSignupStatus} className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
      <Hidden ids={ids} />
      {items.map((p) => (
        <button
          key={p.status}
          type="submit"
          name="status"
          value={p.status}
          disabled={status === p.status}
          className={cn(
            buttonClass(status === p.status ? "primary" : p.status === "withdrawn" ? "danger" : "secondary"),
            "px-2 disabled:opacity-100",
            status === p.status && "ring-2 ring-accent/30",
          )}
        >
          {p.label}
        </button>
      ))}
    </form>
  );
}

/**
 * The auditioner's structured conflicts (plus free-text notes). `against` flags any conflict that
 * overlaps a slot they're booked into, e.g. their callback.
 */
export function ConflictList({
  conflicts,
  notes,
  tz,
  until,
  against = [],
  compact,
}: {
  conflicts: AuditionConflict[];
  notes?: string | null;
  tz: string;
  until?: string | null;
  against?: { label: string; start: Date; end: Date }[];
  compact?: boolean;
}) {
  const hits = against.filter((a) => clashes(conflicts, tz, a.start, a.end, until).length > 0);
  if (conflicts.length === 0 && !notes) {
    return compact ? null : <p className="text-sm text-muted">No conflicts listed.</p>;
  }
  return (
    <div className="space-y-1.5 text-sm">
      {hits.map((h) => (
        <p key={h.label} className="flex items-center gap-1.5 font-semibold text-danger">
          <TriangleAlert className="size-4 shrink-0" aria-hidden /> Conflict during {h.label}
        </p>
      ))}
      {conflicts.length ? (
        <div className="flex items-start gap-1.5">
          <CalendarX2 className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <span className="sr-only">Can&apos;t make: </span>
            {compact ? (
              <span>
                {conflicts
                  .slice(0, 3)
                  .map((c) => fmtConflict(c))
                  .join("; ")}
                {conflicts.length > 3 ? ` +${conflicts.length - 3} more` : ""}
              </span>
            ) : (
              <ul className="space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {fmtConflict(c)}
                    {c.note ? <span className="text-muted"> · {c.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      {notes ? <p className="whitespace-pre-wrap text-muted">“{notes}”</p> : null}
    </div>
  );
}
