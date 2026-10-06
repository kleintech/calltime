import { notFound } from "next/navigation";
import { getProductionAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { fmtDay, fmtTime } from "@/lib/time";
import { fmtHours, getShiftsWithSignups, shiftMinutes } from "@/lib/volunteers";

const cell = (v: string | number | null | undefined) => {
  const s = String(v ?? "");
  // Quote always; neutralise spreadsheet formula injection.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** Volunteer roster as CSV (editors only). */
export async function GET(_: Request, { params }: RouteContext<"/p/[productionId]/volunteers/export.csv">) {
  const { productionId } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();
  const access = await getProductionAccess(user, productionId);
  if (!access?.canEdit) notFound();
  const tz = access.org.timezone;
  const shifts = await getShiftsWithSignups(productionId);
  const rows = [["Shift", "Date", "Start", "End", "Location", "Hours", "Spots", "Volunteer", "For", "Email", "Phone", "Note"]];
  for (const { shift, signups } of shifts) {
    const base = [
      shift.title,
      shift.startsAt ? fmtDay(shift.startsAt, tz) : "Ongoing",
      shift.startsAt ? fmtTime(shift.startsAt, tz) : "",
      shift.endsAt ? fmtTime(shift.endsAt, tz) : "",
      shift.location ?? "",
      fmtHours(shiftMinutes(shift)),
      `${signups.length}/${shift.capacity}`,
    ];
    if (signups.length === 0) rows.push([...base, "(open)", "", "", "", ""]);
    for (const s of signups) rows.push([...base, s.name, s.forName ?? "", s.email, s.phone ?? "", s.note ?? ""]);
  }
  const body = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const slug = access.production.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response("﻿" + body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-volunteers.csv"`,
      "cache-control": "no-store",
    },
  });
}
