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

export function ProductionCard({ production: p, extra }: { production: typeof productions.$inferSelect; extra?: ReactNode }) {
  const opening = fmtDate(p.openingDate);
  const closing = fmtDate(p.closingDate);
  return (
    <Link
      href={`/p/${p.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-line bg-surface p-4 pl-5 shadow-[0_1px_2px_rgba(0,0,0,.04)] hover:bg-surface-2"
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: p.accentColor }} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-tight">{p.title}</p>
          {p.subtitle ? <p className="text-sm text-muted">{p.subtitle}</p> : null}
        </div>
        <Badge tone={p.status === "closed" ? "neutral" : "accent"}>{STATUS_LABEL[p.status]}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        {opening ? <span>Opens {opening}{closing && closing !== opening ? ` – ${closing}` : ""}</span> : null}
        {p.venue ? <span>· {p.venue}</span> : null}
        {extra}
      </div>
    </Link>
  );
}
