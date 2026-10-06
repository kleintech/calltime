import type { ReactNode } from "react";
import { Badge, cn } from "@/components/ui";
import { Ban, RefreshCw } from "lucide-react";
import { KIND_META, personColor, recentChange, type EventKind } from "@/lib/schedule-shared";
import { fmtDay } from "@/lib/time";

const fmtShort = (d: Date, tz: string) => fmtDay(d, tz).replace(/^\w+, /, "");

/* Small presentational pieces shared by the schedule pages and My Calls. Server-safe. */

type BadgeEvent = { status: "draft" | "published" | "cancelled"; revision: number; changedAt: Date | null; updatedAt: Date };

/**
 * Draft / Cancelled / "Updated Oct 4". Updated only shows for a week after the change, so it
 * doesn't become permanent wallpaper that families learn to ignore.
 */
export function StatusBadges({
  event,
  tz,
  now,
  showPublished = false,
  changed: changedOverride,
}: {
  event: BadgeEvent;
  tz: string;
  now: Date;
  showPublished?: boolean;
  /** Per-viewer change date (e.g. unacknowledged change); overrides the 7-day heuristic when given. */
  changed?: Date | null;
}) {
  const changed = changedOverride !== undefined ? changedOverride : recentChange(event, now);
  return (
    <>
      {event.status === "draft" ? <Badge tone="warn">Draft</Badge> : null}
      {event.status === "cancelled" ? (
        <Badge tone="danger">
          <Ban className="size-3" /> Cancelled
        </Badge>
      ) : null}
      {event.status === "published" && showPublished && !changed ? <Badge tone="success">Published</Badge> : null}
      {event.status === "published" && changed ? (
        <Badge tone="gold">
          <RefreshCw className="size-3" /> Updated {fmtShort(changed, tz)}
        </Badge>
      ) : null}
    </>
  );
}

export function KindIcon({ kind, color, className }: { kind: EventKind; color?: string; className?: string }) {
  const Icon = KIND_META[kind].icon;
  return (
    <span
      className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent", className)}
      style={color ? { background: `color-mix(in oklab, ${color} 14%, transparent)`, color } : undefined}
      role="img"
      aria-label={KIND_META[kind].label}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** Colored name chip so a parent with two kids can tell calls apart at a glance. */
export function PersonChip({ name, children, className }: { name: string; children?: ReactNode; className?: string }) {
  const color = personColor(name);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-xs font-semibold", className)}
      style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
    >
      <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full text-[12px] text-white" style={{ background: color }}>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-ink">{children ?? name}</span>
    </span>
  );
}
