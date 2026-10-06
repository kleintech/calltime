"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { events, people, volunteerSettings, volunteerShifts, volunteerSignups } from "@/db/schema";
import { requireProductionAccess, requireProductionEditor } from "@/lib/access";
import { fmtDay, fromLocalInput } from "@/lib/time";
import { ShiftFullError, signUpForShift } from "@/lib/volunteers";
import { firstIssue, type FormState } from "@/app/(app)/org/_components/form-state";

const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const paths = (productionId: string) => {
  revalidatePath(`/p/${productionId}/volunteers`);
  revalidatePath("/account");
};

/** Load a shift and authorize an editor of its production. */
async function editableShift(shiftId: unknown) {
  const id = uuid.parse(shiftId);
  const shift = await db.query.volunteerShifts.findFirst({ where: eq(volunteerShifts.id, id) });
  if (!shift) throw new Error("Shift not found");
  const ctx = await requireProductionEditor(shift.productionId);
  return { shift, ...ctx };
}

const capacity = z.coerce.number().int("Spots must be a whole number.").min(1, "At least 1 spot.").max(500);
const creditHours = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(z.number().min(0, "Hours can't be negative.").max(200, "That's a lot of hours.").nullable());

/** date + start + end (all optional) → instants in the org timezone. Empty date = ongoing role. */
function readWhen(fd: FormData, tz: string): { startsAt: Date | null; endsAt: Date | null } | { error: string } {
  const date = str(fd, "date");
  const start = str(fd, "start");
  const end = str(fd, "end");
  if (!date) {
    if (start || end) return { error: "Pick a date for the times, or clear the times for an ongoing role." };
    return { startsAt: null, endsAt: null };
  }
  if (!start) return { error: "Add a start time (or clear the date for an ongoing role)." };
  try {
    const startsAt = fromLocalInput(date, tz, start);
    const endsAt = end ? fromLocalInput(date, tz, end) : null;
    if (endsAt && endsAt <= startsAt) return { error: "The end time needs to be after the start time." };
    return { startsAt, endsAt };
  } catch {
    return { error: "That date or time doesn't look right." };
  }
}

const shiftSchema = z.object({
  title: z.string().trim().min(1, "Give the shift a name.").max(120),
  description: z.string().trim().max(2000).transform((v) => v || null),
  location: z.string().trim().max(200).transform((v) => v || null),
  capacity,
  creditHours,
});

function readShift(fd: FormData) {
  return shiftSchema.safeParse({
    title: str(fd, "title"),
    description: str(fd, "description"),
    location: str(fd, "location"),
    capacity: str(fd, "capacity") || "1",
    creditHours: str(fd, "creditHours"),
  });
}

export async function createShift(_: FormState, fd: FormData): Promise<FormState> {
  const productionId = uuid.parse(fd.get("productionId"));
  const { org } = await requireProductionEditor(productionId);
  const parsed = readShift(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const when = readWhen(fd, org.timezone);
  if ("error" in when) return when;
  const { creditHours: h, ...rest } = parsed.data;
  await db.insert(volunteerShifts).values({
    productionId,
    ...rest,
    ...when,
    creditMinutes: h == null ? null : Math.round(h * 60),
  });
  paths(productionId);
  return { ok: `Added “${parsed.data.title}”.` };
}

export async function updateShift(_: FormState, fd: FormData): Promise<FormState> {
  const { shift, org } = await editableShift(fd.get("shiftId"));
  const parsed = readShift(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const when = readWhen(fd, org.timezone);
  if ("error" in when) return when;
  const { creditHours: h, ...rest } = parsed.data;
  await db
    .update(volunteerShifts)
    .set({ ...rest, ...when, creditMinutes: h == null ? null : Math.round(h * 60) })
    .where(eq(volunteerShifts.id, shift.id));
  paths(shift.productionId);
  return { ok: "Saved." };
}

export async function deleteShift(fd: FormData) {
  const { shift } = await editableShift(fd.get("shiftId"));
  await db.delete(volunteerShifts).where(eq(volunteerShifts.id, shift.id));
  paths(shift.productionId);
}

export async function removeSignup(fd: FormData) {
  const { shift } = await editableShift(fd.get("shiftId"));
  const userId = uuid.parse(fd.get("userId"));
  await db.delete(volunteerSignups).where(and(eq(volunteerSignups.shiftId, shift.id), eq(volunteerSignups.userId, userId)));
  paths(shift.productionId);
}

/**
 * Quick-create: one shift per line ("Concessions x3" sets 3 spots), either as ongoing roles,
 * all at one date/time, or one copy per performance.
 */
export async function quickCreateShifts(_: FormState, fd: FormData): Promise<FormState> {
  const productionId = uuid.parse(fd.get("productionId"));
  const { org } = await requireProductionEditor(productionId);
  const mode = z.enum(["ongoing", "time", "performances"]).parse(fd.get("mode"));
  const defaultCap = capacity.safeParse(str(fd, "capacity") || "1");
  if (!defaultCap.success) return { error: firstIssue(defaultCap.error) };
  const location = str(fd, "location") || null;

  const lines = str(fd, "titles")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { error: "Type at least one shift name, one per line." };
  if (lines.length > 50) return { error: "That's more than 50 lines — add them in smaller batches." };
  const items = lines.map((l) => {
    const m = l.match(/^(.*?)\s*[x×]\s*(\d{1,3})$/i);
    return m ? { title: m[1].slice(0, 120), capacity: Math.max(1, Number(m[2])) } : { title: l.slice(0, 120), capacity: defaultCap.data };
  });

  let when: { startsAt: Date | null; endsAt: Date | null; suffix: string }[] = [{ startsAt: null, endsAt: null, suffix: "" }];
  if (mode === "time") {
    const w = readWhen(fd, org.timezone);
    if ("error" in w) return w;
    if (!w.startsAt) return { error: "Pick a date and start time, or choose “Ongoing”." };
    when = [{ ...w, suffix: "" }];
  } else if (mode === "performances") {
    const shows = await db
      .select()
      .from(events)
      .where(and(eq(events.productionId, productionId), eq(events.kind, "performance"), ne(events.status, "cancelled")))
      .orderBy(events.startsAt);
    if (shows.length === 0) return { error: "There are no performances on the schedule yet. Add them first, or pick a date." };
    when = shows.map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt, suffix: ` — ${fmtDay(e.startsAt, org.timezone)}` }));
  }

  const rows = when.flatMap((w) =>
    items.map((it) => ({
      productionId,
      title: `${it.title}${w.suffix}`.slice(0, 140),
      capacity: it.capacity,
      location,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
    })),
  );
  await db.insert(volunteerShifts).values(rows);
  paths(productionId);
  return { ok: `Added ${rows.length} shift${rows.length === 1 ? "" : "s"}.` };
}

export async function saveVolunteerSettings(_: FormState, fd: FormData): Promise<FormState> {
  const productionId = uuid.parse(fd.get("productionId"));
  await requireProductionEditor(productionId);
  const parsed = z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int("Use whole hours.").min(0).max(500).nullable())
    .safeParse(str(fd, "requiredHours"));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await db
    .insert(volunteerSettings)
    .values({ productionId, requiredHours: parsed.data || null })
    .onConflictDoUpdate({ target: volunteerSettings.productionId, set: { requiredHours: parsed.data || null } });
  paths(productionId);
  return { ok: parsed.data ? `Families are asked for ${parsed.data} hours.` : "No hours requirement." };
}

/* ───────── Families ───────── */

export type SignupState = { error?: string; done?: boolean };

/** "I'll help": anyone who can open the production may sign up while there's room. */
export async function volunteer(_: SignupState, fd: FormData): Promise<SignupState> {
  const shiftId = uuid.parse(fd.get("shiftId"));
  const shift = await db.query.volunteerShifts.findFirst({ where: eq(volunteerShifts.id, shiftId) });
  if (!shift) return { error: "That shift was removed." };
  const { user, production } = await requireProductionAccess(shift.productionId);
  if (shift.startsAt && (shift.endsAt ?? shift.startsAt) < new Date()) return { error: "That shift is over." };
  // On whose behalf: the user's own person record in this company, if any.
  const own = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.userId, user.id), eq(people.orgId, production.orgId)))
    .limit(1);
  const note = str(fd, "note").slice(0, 500) || null;
  try {
    await signUpForShift({ shiftId, userId: user.id, personId: own[0]?.id ?? null, note });
  } catch (e) {
    if (e instanceof ShiftFullError) return { error: e.message };
    throw e;
  }
  paths(shift.productionId);
  return { done: true };
}

export async function cancelVolunteer(_: SignupState, fd: FormData): Promise<SignupState> {
  const shiftId = uuid.parse(fd.get("shiftId"));
  const shift = await db.query.volunteerShifts.findFirst({ where: eq(volunteerShifts.id, shiftId) });
  if (!shift) return { done: true };
  const { user } = await requireProductionAccess(shift.productionId);
  await db.delete(volunteerSignups).where(and(eq(volunteerSignups.shiftId, shift.id), eq(volunteerSignups.userId, user.id)));
  paths(shift.productionId);
  return { done: true };
}

