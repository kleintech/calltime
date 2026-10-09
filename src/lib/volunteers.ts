import "server-only";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { fmtDay, fmtRange, fmtTime } from "./time";
import { db } from "@/db";
import {
  guardianships,
  people,
  productions,
  roleAssignments,
  roles,
  users,
  volunteerSettings,
  volunteerShifts,
  volunteerSignups,
} from "@/db/schema";

/*
 * Parent / crew volunteer shifts. A signup belongs to an account (a "family"); hours are credited
 * per account. Ongoing roles (no times) count `creditMinutes` if set, else 0.
 */

export type Shift = typeof volunteerShifts.$inferSelect;

const guardianPerson = alias(people, "guardian_person");

/** Minutes credited for a shift. */
export function shiftMinutes(s: Pick<Shift, "creditMinutes" | "startsAt" | "endsAt">) {
  if (s.creditMinutes != null) return s.creditMinutes;
  if (s.startsAt && s.endsAt) return Math.max(0, Math.round((+s.endsAt - +s.startsAt) / 60000));
  return 0;
}

export const fmtHours = (minutes: number) => {
  const h = Math.round((minutes / 60) * 2) / 2; // nearest half hour
  return `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)} hr${h === 1 ? "" : "s"}`;
};

/** "Sat, Nov 14 · 6:00–8:30 PM", or "Ongoing" for roles without a time. */
export function fmtWhen(s: Pick<Shift, "startsAt" | "endsAt">, tz: string) {
  if (!s.startsAt) return "Ongoing — help across the run";
  return `${fmtDay(s.startsAt, tz)} · ${s.endsAt ? fmtRange(s.startsAt, s.endsAt, tz) : fmtTime(s.startsAt, tz)}`;
}

/** A shift is still "open for signups" until it starts; ongoing roles stay open. */
export function isUpcoming(s: Pick<Shift, "startsAt" | "endsAt">, now = new Date()) {
  return !s.startsAt || (s.endsAt ?? s.startsAt) > now;
}

/** Dated shifts in time order, then ongoing roles by title. */
function sortShifts<T extends Pick<Shift, "startsAt" | "title">>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.startsAt && b.startsAt) return +a.startsAt - +b.startsAt;
    if (a.startsAt) return -1;
    if (b.startsAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

export type ShiftSignup = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  forName: string | null;
  createdAt: Date;
};

/** Every shift in a production with its signups (contact info included — editors only!). */
export async function getShiftsWithSignups(productionId: string) {
  const shifts = await db.select().from(volunteerShifts).where(eq(volunteerShifts.productionId, productionId));
  const ids = shifts.map((s) => s.id);
  const rows = ids.length
    ? await db
        .select({
          shiftId: volunteerSignups.shiftId,
          userId: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          note: volunteerSignups.note,
          createdAt: volunteerSignups.createdAt,
          forFirst: people.firstName,
          forLast: people.lastName,
        })
        .from(volunteerSignups)
        .innerJoin(users, eq(users.id, volunteerSignups.userId))
        .leftJoin(people, eq(people.id, volunteerSignups.personId))
        .where(inArray(volunteerSignups.shiftId, ids))
        .orderBy(asc(volunteerSignups.createdAt))
    : [];
  const byShift = new Map<string, ShiftSignup[]>();
  for (const r of rows) {
    const list = byShift.get(r.shiftId) ?? [];
    list.push({
      userId: r.userId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      note: r.note,
      forName: r.forFirst ? `${r.forFirst} ${r.forLast ?? ""}`.trim() : null,
      createdAt: r.createdAt,
    });
    byShift.set(r.shiftId, list);
  }
  return sortShifts(shifts).map((s) => {
    const signups = byShift.get(s.id) ?? [];
    return { shift: s, signups, spotsLeft: Math.max(0, s.capacity - signups.length) };
  });
}

export async function getVolunteerSettings(productionId: string) {
  const row = await db.query.volunteerSettings.findFirst({ where: eq(volunteerSettings.productionId, productionId) });
  return { requiredHours: row?.requiredHours ?? null };
}

/**
 * Family accounts for a production: anyone with an account who is cast themselves or is a guardian
 * of someone cast. Returns userId → name/email plus the cast members they cover.
 */
export async function getProductionFamilies(productionId: string) {
  const cast = await db
    .selectDistinct({ person: people })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(people, eq(people.id, roleAssignments.personId))
    .where(eq(roles.productionId, productionId));
  const castIds = cast.map((c) => c.person.id);
  const families = new Map<string, { userId: string; name: string; email: string; covers: Set<string> }>();
  const addUser = (u: { id: string; name: string; email: string }, kid: string) => {
    const f = families.get(u.id) ?? { userId: u.id, name: u.name, email: u.email, covers: new Set<string>() };
    f.covers.add(kid);
    families.set(u.id, f);
  };
  if (castIds.length === 0) return [];
  const selfRows = await db
    .select({ user: users, person: people })
    .from(people)
    .innerJoin(users, eq(users.id, people.userId))
    .where(inArray(people.id, castIds));
  for (const r of selfRows) addUser(r.user, r.person.firstName);
  const guardianRows = await db
    .select({ user: users, kid: people.firstName })
    .from(guardianships)
    .innerJoin(people, eq(people.id, guardianships.minorId))
    .innerJoin(guardianPerson, eq(guardianPerson.id, guardianships.guardianId))
    .innerJoin(users, eq(users.id, guardianPerson.userId))
    .where(inArray(guardianships.minorId, castIds));
  for (const r of guardianRows) addUser(r.user, r.kid);
  return [...families.values()]
    .map((f) => ({ ...f, covers: [...f.covers].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Minutes signed up per user in a production. */
export async function getHoursByUser(productionId: string) {
  const rows = await db
    .select({ userId: volunteerSignups.userId, shift: volunteerShifts })
    .from(volunteerSignups)
    .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerSignups.shiftId))
    .where(eq(volunteerShifts.productionId, productionId));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.userId, (m.get(r.userId) ?? 0) + shiftMinutes(r.shift));
  return m;
}

/** A user's own signups (optionally within one production), soonest first. */
export async function getMySignups(userId: string, productionId?: string) {
  const rows = await db
    .select({ shift: volunteerShifts, production: productions, note: volunteerSignups.note })
    .from(volunteerSignups)
    .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerSignups.shiftId))
    .innerJoin(productions, eq(productions.id, volunteerShifts.productionId))
    .where(and(eq(volunteerSignups.userId, userId), productionId ? eq(volunteerShifts.productionId, productionId) : undefined));
  const sorted = sortShifts(rows.map((r) => ({ ...r.shift, _r: r })));
  return sorted.map((s) => s._r);
}

/** Count of upcoming shifts with spots left, per production (for teasers). */
export async function countOpenShifts(productionIds: string[]) {
  if (productionIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      productionId: volunteerShifts.productionId,
      capacity: volunteerShifts.capacity,
      taken: sql<number>`(select count(*)::int from ${volunteerSignups} where ${volunteerSignups.shiftId} = ${volunteerShifts.id})`,
    })
    .from(volunteerShifts)
    .where(
      and(
        inArray(volunteerShifts.productionId, productionIds),
        or(isNull(volunteerShifts.startsAt), gt(sql`coalesce(${volunteerShifts.endsAt}, ${volunteerShifts.startsAt})`, new Date())),
      ),
    );
  const m = new Map<string, number>();
  for (const r of rows) if (r.taken < r.capacity) m.set(r.productionId, (m.get(r.productionId) ?? 0) + 1);
  return m;
}

export class ShiftFullError extends Error {}

/**
 * Sign a user up, respecting capacity under concurrency: the shift row is locked for the duration
 * of the check + insert. Idempotent for an existing signup.
 */
export async function signUpForShift(args: { shiftId: string; userId: string; personId: string | null; note: string | null }) {
  return db.transaction(async (tx) => {
    const [shift] = await tx.select().from(volunteerShifts).where(eq(volunteerShifts.id, args.shiftId)).for("update");
    if (!shift) throw new ShiftFullError("That shift no longer exists.");
    const existing = await tx.query.volunteerSignups.findFirst({
      where: and(eq(volunteerSignups.shiftId, shift.id), eq(volunteerSignups.userId, args.userId)),
    });
    if (existing) return shift;
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(volunteerSignups)
      .where(eq(volunteerSignups.shiftId, shift.id));
    if (n >= shift.capacity) throw new ShiftFullError("Sorry — that shift just filled up.");
    await tx.insert(volunteerSignups).values({ shiftId: shift.id, userId: args.userId, personId: args.personId, note: args.note });
    return shift;
  });
}
