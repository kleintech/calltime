import {
  CalendarDays,
  Lightbulb,
  MicVocal,
  Scissors,
  Shirt,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { format, startOfWeek } from "date-fns";
import { z } from "zod";

/*
 * Schedule helpers safe for both server and client components (no db access).
 * Server-only logic lives in src/lib/schedule.ts.
 */

export const EVENT_KINDS = ["rehearsal", "performance", "tech", "dress", "fitting", "meeting", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const KIND_META: Record<EventKind, { label: string; icon: LucideIcon }> = {
  rehearsal: { label: "Rehearsal", icon: MicVocal },
  performance: { label: "Performance", icon: Sparkles },
  tech: { label: "Tech", icon: Lightbulb },
  dress: { label: "Dress rehearsal", icon: Shirt },
  fitting: { label: "Costume fitting", icon: Scissors },
  meeting: { label: "Meeting", icon: UsersRound },
  other: { label: "Other", icon: CalendarDays },
};

export const CALL_TARGETS = ["scene", "role", "group", "person", "all_cast"] as const;
export type CallTargetKind = (typeof CALL_TARGETS)[number];
export type CallRef = { target: CallTargetKind; targetId: string | null };

/** Stable key for a call target, e.g. "scene:<uuid>" or "all_cast:". */
export const callKey = (c: CallRef) => `${c.target}:${c.targetId ?? ""}`;

/** Same hue formula as <Avatar>, so a person's chip color matches their avatar everywhere. */
export function personHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
export const personColor = (name: string) => `hsl(${personHue(name)} 45% 36%)`;

export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/** "Act 1 Sc 3" — short form of sceneLabel for summaries. */
export function sceneShort(s: { act: number; number: string }) {
  const num = /^\d+[A-Za-z]?$/.test(s.number) ? `Sc ${s.number}` : s.number;
  return `Act ${s.act} ${num}`;
}

/* ───────────── Event editor payload (validated on the server) ───────────── */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const optText = (max: number) => z.string().trim().max(max).default("");

export const callSchema = z
  .object({ target: z.enum(CALL_TARGETS), targetId: z.uuid().nullable() })
  .refine((c) => (c.target === "all_cast") === (c.targetId === null), "Invalid call target");

export const blockSchema = z
  .object({
    start: hhmm,
    end: hhmm,
    title: optText(200),
    leader: optText(100),
    location: optText(200),
    notes: optText(2000),
    calls: z.array(callSchema).max(300),
  })
  .refine((b) => b.end > b.start, { message: "Each block must end after it starts" });

export const eventInputSchema = z
  .object({
    id: z.uuid().optional(),
    kind: z.enum(EVENT_KINDS),
    title: z.string().trim().min(1, "Give the event a title").max(200),
    date: ymd,
    start: hhmm,
    end: hhmm,
    location: optText(200),
    notes: optText(4000),
    /** Optional "what changed" note for families, used when a published event changes. */
    changeNote: optText(300).optional(),
    blocks: z.array(blockSchema).max(60),
  })
  .refine((e) => e.end > e.start, { message: "The event must end after it starts" });

export type EventInput = z.input<typeof eventInputSchema>;
export type BlockInput = z.input<typeof blockSchema>;

/* ───────────── Data shipped to the editor for the live preview ───────────── */

export type EditorOptions = {
  tz: string;
  defaultLocation: string;
  scenes: { id: string; act: number; short: string; name: string; label: string }[];
  groups: { id: string; name: string; color: string | null }[];
  roles: { id: string; name: string; kind: string }[];
  people: { id: string; name: string; firstName: string; isMinor: boolean }[];
  /** callKey → personIds, resolved server-side by the call engine (resolveTarget). */
  resolved: Record<string, string[]>;
  /** callKey → human label (targetLabel). */
  labels: Record<string, string>;
  conflicts: { id: string; personId: string; startsAt: string; endsAt: string; note: string | null }[];
};

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

const CHANGE_FRESH_MS = 7 * 86400_000;

/** When a published event last changed materially, if that was recent enough to flag (7 days). */
export function recentChange(
  ev: { status: string; revision: number; changedAt: Date | null; updatedAt: Date },
  now: Date,
): Date | null {
  if (ev.status === "draft" || ev.revision === 0) return null;
  const at = ev.changedAt ?? ev.updatedAt;
  return now.getTime() - at.getTime() <= CHANGE_FRESH_MS ? at : null;
}

/** Apple Maps search link: opens Maps on iOS/macOS and redirects to Google Maps elsewhere. */
export const mapsUrl = (q: string) => `https://maps.apple.com/?q=${encodeURIComponent(q)}`;

/** Monday (in tz) of the week containing d, as "yyyy-MM-dd" — used for week anchors (#week-…). */
export const weekKey = (d: Date, tz: string) => format(startOfWeek(new TZDate(d.getTime(), tz), { weekStartsOn: 1 }), "yyyy-MM-dd");

/** The same wall-clock time `days` calendar days later in tz (DST-safe, unlike +24h). */
export const addLocalDays = (d: Date, days: number, tz: string) =>
  new Date(new TZDate(d.getTime(), tz).setDate(new TZDate(d.getTime(), tz).getDate() + days));
