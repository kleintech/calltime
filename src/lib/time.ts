import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * All instants are stored as timestamptz (UTC). Everything shown to people is rendered in the
 * organization's timezone (organizations.timezone), never the server's or the browser's.
 */

const z = (d: Date | string, tz: string) => new TZDate(new Date(d).getTime(), tz);

/** "6:00 PM" */
export const fmtTime = (d: Date | string, tz: string) => format(z(d, tz), "h:mm a");
/** "6:00" without meridiem when both ends share it is handled by fmtRange */
export const fmtRange = (a: Date | string, b: Date | string, tz: string) => {
  const A = z(a, tz);
  const B = z(b, tz);
  const sameMeridiem = format(A, "a") === format(B, "a");
  return `${format(A, sameMeridiem ? "h:mm" : "h:mm a")}–${format(B, "h:mm a")}`;
};
/** "Tue, Oct 7" */
export const fmtDay = (d: Date | string, tz: string) => format(z(d, tz), "EEE, MMM d");
/** "Tuesday, October 7" */
export const fmtDayLong = (d: Date | string, tz: string) => format(z(d, tz), "EEEE, MMMM d");
/** "2026-10-07" — local calendar day key for grouping */
export const dayKey = (d: Date | string, tz: string) => format(z(d, tz), "yyyy-MM-dd");
/** "Tue, Oct 7 · 6:00 PM" */
export const fmtDateTime = (d: Date | string, tz: string) => format(z(d, tz), "EEE, MMM d · h:mm a");

/** Value for <input type="datetime-local"> in the given timezone: "2026-10-07T18:00" */
export const toLocalInput = (d: Date | string, tz: string) => format(z(d, tz), "yyyy-MM-dd'T'HH:mm");
/** Value for <input type="date">: "2026-10-07" */
export const toDateInput = (d: Date | string, tz: string) => format(z(d, tz), "yyyy-MM-dd");
/** Value for <input type="time">: "18:00" */
export const toTimeInput = (d: Date | string, tz: string) => format(z(d, tz), "HH:mm");

/**
 * Parse a wall-clock time in tz into an instant.
 * Accepts "2026-10-07T18:00" (datetime-local) or date "2026-10-07" + time "18:00".
 */
export function fromLocalInput(value: string, tz: string, time?: string): Date {
  const [datePart, timePart = time ?? "00:00"] = time ? [value, time] : value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) throw new Error(`Invalid date/time: ${value} ${time ?? ""}`);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime());
}

/** Start of the local day in tz, as an instant. */
export function startOfLocalDay(d: Date, tz: string): Date {
  const t = z(d, tz);
  return new Date(new TZDate(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, tz).getTime());
}

export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "Europe/London",
  "Australia/Sydney",
];
