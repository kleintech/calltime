import { cn } from "@/components/ui";

export type MeterData = {
  count: number;
  /** ISO string or null */
  last: string | null;
  daysAgo: number | null;
  nextLabel: string | null;
};

const tone = (daysAgo: number | null) =>
  daysAgo === null ? "bg-warn" : daysAgo <= 7 ? "bg-success" : daysAgo <= 14 ? "bg-gold" : "bg-warn";

/**
 * Small bar + words: how often a scene has been worked and how recently. The bar length is the
 * count relative to the most-rehearsed scene; its color tracks recency. The text carries the same
 * information so color is never the only signal.
 */
export function RehearsalMeter({ d, max, started }: { d: MeterData; max: number; started: boolean }) {
  const pct = max > 0 ? Math.max(d.count > 0 ? 8 : 0, Math.round((d.count / max) * 100)) : 0;
  const stale = d.daysAgo === null || d.daysAgo > 14;
  const words =
    d.count === 0
      ? started
        ? "Not rehearsed yet"
        : "Not rehearsed"
      : `${d.count}× · ${d.daysAgo === 0 ? "today" : d.daysAgo === 1 ? "yesterday" : `${d.daysAgo} days ago`}`;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={cn("block h-full rounded-full", tone(d.daysAgo))} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn(started && stale ? "font-medium text-warn" : "text-muted")}>{words}</span>
      {d.nextLabel ? <span className="truncate text-muted">· next {d.nextLabel}</span> : null}
    </div>
  );
}
