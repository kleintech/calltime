import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { attendance } from "@/db/schema";
import { BackLink } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { getEventCallSheet } from "@/lib/calls";
import { ensureExcusedForConflicts, getGuardianContacts } from "@/lib/schedule";
import { personName } from "@/lib/schedule-shared";
import { fmtDay, fmtRange } from "@/lib/time";
import { AttendanceSheet, type AttendancePerson } from "./attendance-sheet";

/** Stage manager's check-in: everyone called, by call time; one tap per person. */
export default async function AttendancePage({ params }: PageProps<"/p/[productionId]/schedule/[eventId]/attendance">) {
  const { productionId, eventId } = await params;
  const { org, user } = await requireProductionEditor(productionId);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const sheet = await getEventCallSheet(eventId);
  if (!sheet || sheet.event.productionId !== productionId) notFound();
  const tz = org.timezone;

  await ensureExcusedForConflicts(eventId, productionId, sheet.calls, user.id);
  const rows = await db.select().from(attendance).where(eq(attendance.eventId, eventId));
  const byPerson = new Map(rows.map((r) => [r.personId, r]));
  const ids = [...sheet.calls.keys()];
  const guardians = await getGuardianContacts(ids.filter((id) => sheet.people.get(id)?.isMinor));

  const people: AttendancePerson[] = [...sheet.calls.values()]
    .map((c) => {
      const p = sheet.people.get(c.personId);
      const a = byPerson.get(c.personId);
      return {
        id: c.personId,
        name: p ? personName(p) : "Unknown",
        isMinor: !!p?.isMinor,
        callAt: c.callAt.toISOString(),
        releaseAt: c.releaseAt.toISOString(),
        reasons: c.reasons,
        status: a?.status ?? null,
        note: a?.note ?? null,
        checkedInAt: a?.checkedInAt?.toISOString() ?? null,
        checkedOutAt: a?.checkedOutAt?.toISOString() ?? null,
        pickedUpBy: a?.pickedUpBy ?? null,
        guardians: (guardians.get(c.personId) ?? []).map((g) => g.name),
      };
    })
    .sort((a, b) => a.callAt.localeCompare(b.callAt) || a.name.localeCompare(b.name));

  return (
    <div>
      <BackLink href={`/p/${productionId}/schedule/${eventId}`} label={sheet.event.title} />
      <h2 className="mt-2 font-display text-2xl font-semibold">Attendance</h2>
      <p className="text-sm text-muted">
        {fmtDay(sheet.event.startsAt, tz)} · {fmtRange(sheet.event.startsAt, sheet.event.endsAt, tz)}
        {sheet.event.status === "cancelled" ? " · Cancelled" : ""}
      </p>
      <AttendanceSheet productionId={productionId} eventId={eventId} tz={tz} people={people} />
    </div>
  );
}
