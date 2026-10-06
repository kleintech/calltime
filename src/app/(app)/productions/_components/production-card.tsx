import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { productions } from "@/db/schema";
import { Badge } from "@/components/ui";
import { STATUS_LABEL } from "./constants";

function fmtDate(d: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  // A calendar date (no instant), so format it without any timezone conversion.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${day}, ${y}`;
}

export function fmtCalendarDate(d: string | null) {
  return fmtDate(d);
}

const STATUS_TONE = {
  planning: "neutral",
  auditions: "gold",
  rehearsals: "accent",
  performances: "success",
  closed: "neutral",
} as const;

/** A show as a little poster: production-color wash, display title, status, dates and venue. */
export function ProductionCard({ production: p, extra }: { production: typeof productions.$inferSelect; extra?: ReactNode }) {
  const opening = fmtDate(p.openingDate);
  const closing = fmtDate(p.closingDate);
  return (
    <Link
      href={`/p/${p.id}`}
      className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-card transition-[box-shadow,transform] duration-200 hover:shadow-raised active:scale-[.99]"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-24"
        style={{ background: `linear-gradient(to bottom, color-mix(in oklab, ${p.accentColor} 18%, transparent), transparent)` }}
      />
      <div className="flex items-start justify-between gap-3 p-4 pb-0">
        <span
          aria-hidden
          className="mt-2 size-2.5 shrink-0 rounded-full"
          style={{ background: p.accentColor, boxShadow: `0 0 0 4px color-mix(in oklab, ${p.accentColor} 20%, transparent)` }}
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-semibold leading-tight tracking-tight">{p.title}</p>
          {p.subtitle ? <p className="mt-0.5 text-sm text-muted">{p.subtitle}</p> : null}
        </div>
        <Badge tone={STATUS_TONE[p.status]} dot>
          {STATUS_LABEL[p.status]}
        </Badge>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4 pt-3 text-sm text-muted">
        {opening ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden className="size-4" />
            {opening}
            {closing && closing !== opening ? ` – ${closing}` : ""}
          </span>
        ) : null}
        {p.venue ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{p.venue}</span>
          </span>
        ) : null}
        {extra}
      </div>
    </Link>
  );
}
