import "server-only";
import { getSlotsWithCounts, nowMs } from "@/lib/auditions";
import { fmtDayLong, fmtRange, fmtTime } from "@/lib/time";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export type SlotOption = { id: string; day: string; range: string; short: string; remaining: number; label: string | null };

/** Future audition slots for the public picker, including full ones (shown disabled so people know they existed). */
export async function publicSlotOptions(auditionId: string, tz: string): Promise<SlotOption[]> {
  const now = nowMs();
  return (await getSlotsWithCounts(auditionId))
    .filter((s) => s.kind === "audition" && s.startsAt.getTime() > now)
    .map((s) => ({
      id: s.id,
      day: fmtDayLong(s.startsAt, tz),
      range: fmtRange(s.startsAt, s.endsAt, tz),
      short: `${format(new TZDate(s.startsAt.getTime(), tz), "EEE")} ${fmtTime(s.startsAt, tz)}`,
      remaining: s.remaining,
      label: s.label,
    }));
}
