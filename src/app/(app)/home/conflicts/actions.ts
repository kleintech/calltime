"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { conflicts, organizations, people, roleAssignments, roles } from "@/db/schema";
import { getCoveredPersonIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { fromLocalInput } from "@/lib/time";

export type ConflictState = { error?: string; ok?: boolean; at?: number };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");

const schema = z
  .object({
    personIds: z.array(z.uuid()).min(1, "Choose who can't make it").max(20),
    productionId: z.union([z.uuid(), z.literal("")]),
    date: ymd,
    allDay: z.boolean(),
    untilDate: z.union([ymd, z.literal("")]),
    start: z.union([hhmm, z.literal("")]),
    end: z.union([hhmm, z.literal("")]),
    note: z.string().trim().max(500),
  })
  .refine((v) => v.allDay || (v.start && v.end && v.end > v.start), { message: "End time must be after the start time" })
  .refine((v) => !v.allDay || !v.untilDate || v.untilDate >= v.date, { message: "The end date is before the start date" });

function addDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export async function addConflict(_: ConflictState, fd: FormData): Promise<ConflictState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    personIds: fd.getAll("personId").map(String),
    productionId: String(fd.get("productionId") ?? ""),
    date: String(fd.get("date") ?? ""),
    allDay: fd.get("allDay") === "on",
    untilDate: String(fd.get("untilDate") ?? ""),
    start: String(fd.get("start") ?? ""),
    end: String(fd.get("end") ?? ""),
    note: String(fd.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const v = parsed.data;

  const covered = await getCoveredPersonIds(user.id);
  const personIds = [...new Set(v.personIds)];
  if (!personIds.every((id) => covered.includes(id))) return { error: "You can only add conflicts for yourself or your family." };

  if (v.productionId) {
    const cast = await db
      .selectDistinct({ personId: roleAssignments.personId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(inArray(roleAssignments.personId, personIds), eq(roles.productionId, v.productionId)));
    if (cast.length !== personIds.length) return { error: "That show isn't one they're all cast in." };
  }

  const tzRows = await db
    .select({ id: people.id, tz: organizations.timezone })
    .from(people)
    .innerJoin(organizations, eq(organizations.id, people.orgId))
    .where(inArray(people.id, personIds));
  const tzOf = new Map(tzRows.map((r) => [r.id, r.tz]));

  await db.insert(conflicts).values(
    personIds.map((personId) => {
      const tz = tzOf.get(personId) ?? "America/New_York";
      return {
        personId,
        productionId: v.productionId || null,
        startsAt: v.allDay ? fromLocalInput(v.date, tz, "00:00") : fromLocalInput(v.date, tz, v.start),
        endsAt: v.allDay ? fromLocalInput(addDay(v.untilDate || v.date), tz, "00:00") : fromLocalInput(v.date, tz, v.end),
        note: v.note || null,
        createdByUserId: user.id,
      };
    }),
  );
  revalidatePath("/home", "layout");
  revalidatePath("/p/[productionId]", "layout");
  return { ok: true, at: Date.now() };
}

export async function deleteConflict(conflictId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(conflictId).success) return { ok: false, error: "Not found" };
  const covered = await getCoveredPersonIds(user.id);
  if (!covered.length) return { ok: false, error: "Not found" };
  const res = await db
    .delete(conflicts)
    .where(and(eq(conflicts.id, conflictId), inArray(conflicts.personId, covered)))
    .returning({ id: conflicts.id });
  if (!res.length) return { ok: false, error: "Not found" };
  revalidatePath("/home", "layout");
  revalidatePath("/p/[productionId]", "layout");
  return { ok: true };
}
