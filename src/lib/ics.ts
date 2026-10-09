/**
 * Minimal, dependency-free RFC 5545 (iCalendar) writer for the subscription feeds.
 *
 * - Lines end in CRLF (§3.1).
 * - Content lines are folded at 75 octets (UTF-8 bytes, never splitting a multi-byte character);
 *   continuation lines start with a single space (§3.1).
 * - TEXT values escape backslash, semicolon, comma and newlines (§3.3.11).
 * - DATE-TIME values are written in UTC with the "Z" suffix (§3.3.5, form #2).
 */

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** iCalendar SEQUENCE: bump on every material change so clients replace the old copy. */
  sequence?: number;
  lastModified?: Date;
  /** Defaults to "now" (time the feed was generated). */
  dtstamp?: Date;
  url?: string | null;
  /** Whole-day informational entry (DTSTART;VALUE=DATE), shown as free time. */
  allDay?: boolean;
};

export type IcsCalendar = {
  name: string;
  description?: string;
  prodId?: string;
  /** e.g. "PT1H" — emitted as REFRESH-INTERVAL and X-PUBLISHED-TTL. */
  refresh?: string;
  events: IcsEvent[];
};

/** Escape a TEXT value (§3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** UTC DATE-TIME, e.g. 20261007T220000Z. */
export function formatUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const encoder = new TextEncoder();

/**
 * Fold one content line to ≤75 octets per physical line. Splits only between code points
 * (never inside a UTF-8 sequence or a surrogate pair). Continuation lines begin with one
 * space, which counts toward their 75 octets.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    // for..of iterates by code point, so surrogate pairs stay together.
    const bytes = encoder.encode(ch).length;
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // the leading space of the continuation line takes one octet
    }
    current += ch;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

function prop(name: string, value: string) {
  return foldLine(`${name}:${value}`);
}

export function buildCalendar(cal: IcsCalendar): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    prop("PRODID", cal.prodId ?? "-//Calltime//Calltime Schedule//EN"),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeText(cal.name)),
    prop("NAME", escapeText(cal.name)),
  ];
  if (cal.description) {
    lines.push(prop("X-WR-CALDESC", escapeText(cal.description)));
    lines.push(prop("DESCRIPTION", escapeText(cal.description)));
  }
  if (cal.refresh) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${cal.refresh}`);
    lines.push(`X-PUBLISHED-TTL:${cal.refresh}`);
  }

  for (const e of cal.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(prop("UID", e.uid));
    lines.push(`DTSTAMP:${formatUtc(e.dtstamp ?? now)}`);
    if (e.allDay) {
      const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${day(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${day(new Date(e.start.getTime() + 86400_000))}`);
    } else {
      lines.push(`DTSTART:${formatUtc(e.start)}`);
      lines.push(`DTEND:${formatUtc(e.end > e.start ? e.end : new Date(e.start.getTime() + 60_000))}`);
    }
    lines.push(`SEQUENCE:${Math.max(0, Math.trunc(e.sequence ?? 0))}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${formatUtc(e.lastModified)}`);
    lines.push(prop("SUMMARY", escapeText(e.summary)));
    if (e.description) lines.push(prop("DESCRIPTION", escapeText(e.description)));
    if (e.location) lines.push(prop("LOCATION", escapeText(e.location)));
    if (e.url) lines.push(prop("URL", e.url));
    lines.push(`STATUS:${e.status ?? "CONFIRMED"}`);
    lines.push(e.allDay ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
