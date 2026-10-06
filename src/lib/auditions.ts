import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  auditionSignups,
  auditionSlots,
  auditions,
  conflicts,
  guardianships,
  organizations,
  people,
  productions,
  roleAssignments,
  roles,
} from "@/db/schema";
import { z } from "zod";
import { normalizeEmail, randomToken } from "./auth";
import { fromLocalInput } from "./time";

/*
 * Shared audition logic: slot capacity, public lookup, casting a signup into people/roles, ICS.
 * Authorization lives in the callers (editor actions use requireProductionEditor; public actions
 * authenticate by slug / manageToken).
 */

export type Audition = typeof auditions.$inferSelect;
export type AuditionSlot = typeof auditionSlots.$inferSelect;
export type AuditionSignup = typeof auditionSignups.$inferSelect;
export type SignupStatus = AuditionSignup["status"];
export type AuditionQuestion = Audition["questions"][number];

export const STATUS_LABEL: Record<SignupStatus, string> = {
  registered: "Registered",
  checked_in: "Checked in",
  auditioned: "Auditioned",
  callback: "Callback",
  cast: "Cast",
  not_cast: "Not cast",
  withdrawn: "Withdrawn",
};

export const STATUS_TONE: Record<SignupStatus, "neutral" | "accent" | "gold" | "success" | "danger" | "warn"> = {
  registered: "neutral",
  checked_in: "accent",
  auditioned: "warn",
  callback: "gold",
  cast: "success",
  not_cast: "neutral",
  withdrawn: "danger",
};

export const SIGNUP_STATUSES = Object.keys(STATUS_LABEL) as SignupStatus[];

/** Statuses that still occupy a seat in a slot. */
const OCCUPYING = sql`${auditionSignups.status} <> 'withdrawn'`;

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "auditions"
  );
}

/** A unique public slug derived from the title. */
export async function uniqueSlug(title: string, exceptAuditionId?: string) {
  const base = slugify(title);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    const hit = await db.query.auditions.findFirst({ where: eq(auditions.slug, candidate) });
    if (!hit || hit.id === exceptAuditionId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Slots for an audition with the number of seats taken (audition slots count slotId, callbacks callbackSlotId). */
export async function getSlotsWithCounts(auditionId: string) {
  const slots = await db
    .select()
    .from(auditionSlots)
    .where(eq(auditionSlots.auditionId, auditionId))
    .orderBy(asc(auditionSlots.startsAt));
  if (slots.length === 0) return [];
  const ids = slots.map((s) => s.id);
  const [main, cb] = await Promise.all([
    db
      .select({ slotId: auditionSignups.slotId, n: sql<number>`count(*)::int` })
      .from(auditionSignups)
      .where(and(inArray(auditionSignups.slotId, ids), OCCUPYING))
      .groupBy(auditionSignups.slotId),
    db
      .select({ slotId: auditionSignups.callbackSlotId, n: sql<number>`count(*)::int` })
      .from(auditionSignups)
      .where(and(inArray(auditionSignups.callbackSlotId, ids), OCCUPYING))
      .groupBy(auditionSignups.callbackSlotId),
  ]);
  const mainCount = new Map(main.map((r) => [r.slotId, r.n]));
  const cbCount = new Map(cb.map((r) => [r.slotId, r.n]));
  return slots.map((s) => {
    const filled = (s.kind === "callback" ? cbCount.get(s.id) : mainCount.get(s.id)) ?? 0;
    return { ...s, filled, remaining: Math.max(0, s.capacity - filled) };
  });
}
export type SlotWithCount = Awaited<ReturnType<typeof getSlotsWithCounts>>[number];

/** Audition-kind slots a member of the public may pick: future, with remaining capacity. */
export async function getOpenSlots(auditionId: string) {
  const now = Date.now();
  return (await getSlotsWithCounts(auditionId)).filter(
    (s) => s.kind === "audition" && s.remaining > 0 && s.startsAt.getTime() > now,
  );
}

/** Public lookup by slug, with the production + org (timezone) for rendering. */
export async function getPublicAudition(slug: string) {
  const rows = await db
    .select({ audition: auditions, production: productions, org: organizations })
    .from(auditions)
    .innerJoin(productions, eq(productions.id, auditions.productionId))
    .innerJoin(organizations, eq(organizations.id, productions.orgId))
    .where(eq(auditions.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** Editor-side lookup: the audition must belong to this production, else 404. */
export async function getAuditionForProduction(productionId: string, auditionId: string) {
  if (!isUuid(auditionId)) notFound();
  const audition = await db.query.auditions.findFirst({
    where: and(eq(auditions.id, auditionId), eq(auditions.productionId, productionId)),
  });
  if (!audition) notFound();
  return audition;
}

export class SlotFullError extends Error {
  constructor() {
    super("That time slot just filled up. Please pick another.");
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock the slot row and check capacity inside the caller's transaction. Concurrent signups for the
 * same slot serialize on the row lock, so two people can't both take the last seat.
 */
async function assertSeat(tx: Tx, slotId: string, auditionId: string, kind: "audition" | "callback", ignoreSignupId?: string) {
  const [slot] = await tx
    .select({ capacity: auditionSlots.capacity })
    .from(auditionSlots)
    .where(and(eq(auditionSlots.id, slotId), eq(auditionSlots.auditionId, auditionId), eq(auditionSlots.kind, kind)))
    .for("update");
  if (!slot) throw new Error("Slot not found");
  const col = kind === "callback" ? auditionSignups.callbackSlotId : auditionSignups.slotId;
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(auditionSignups)
    .where(
      and(eq(col, slotId), OCCUPYING, ignoreSignupId ? ne(auditionSignups.id, ignoreSignupId) : undefined),
    );
  if (n >= slot.capacity) throw new SlotFullError();
}

export type NewSignup = Omit<typeof auditionSignups.$inferInsert, "id" | "manageToken" | "status" | "createdAt">;

/** Public insert with an atomic capacity check. Returns the new signup. */
export async function insertSignupWithCapacity(values: NewSignup) {
  return db.transaction(async (tx) => {
    if (values.slotId) {
      await assertSeat(tx, values.slotId, values.auditionId, "audition");
      const [slot] = await tx.select().from(auditionSlots).where(eq(auditionSlots.id, values.slotId));
      if (slot.startsAt.getTime() < Date.now()) throw new Error("That slot has already started.");
    }
    const [row] = await tx
      .insert(auditionSignups)
      .values({ ...values, manageToken: randomToken(18) })
      .returning();
    return row;
  });
}

/**
 * Move a signup to another slot. `enforceCapacity` is on for the public manage page; editors may
 * deliberately overbook (the UI shows the slot as full).
 */
export async function moveSignupSlot(opts: {
  signupId: string;
  auditionId: string;
  slotId: string | null;
  kind: "audition" | "callback";
  enforceCapacity: boolean;
}) {
  return db.transaction(async (tx) => {
    if (opts.slotId) {
      if (opts.enforceCapacity) await assertSeat(tx, opts.slotId, opts.auditionId, opts.kind, opts.signupId);
      else {
        const [slot] = await tx
          .select({ id: auditionSlots.id })
          .from(auditionSlots)
          .where(
            and(
              eq(auditionSlots.id, opts.slotId),
              eq(auditionSlots.auditionId, opts.auditionId),
              eq(auditionSlots.kind, opts.kind),
            ),
          );
        if (!slot) throw new Error("Slot not found");
      }
    }
    await tx
      .update(auditionSignups)
      .set(opts.kind === "callback" ? { callbackSlotId: opts.slotId } : { slotId: opts.slotId })
      .where(and(eq(auditionSignups.id, opts.signupId), eq(auditionSignups.auditionId, opts.auditionId)));
  });
}

/* ───────────────────────── Casting ───────────────────────── */

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || "Guardian", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export type CastResult = {
  personId: string;
  personName: string;
  createdPerson: boolean;
  guardian: { personId: string; name: string; email: string | null; created: boolean } | null;
  conflictsAdded: number;
};

/**
 * Turn a signup into an org `people` row and role assignments.
 * - Reuses signup.personId if already linked; otherwise matches an org person by email + first name
 *   (siblings often share a parent's email, so email alone would merge different kids), else creates one.
 * - Guardian (from guardianName / guardianEmail) is reused by email within the org, else created,
 *   and linked by a guardianship.
 * - Role assignments upsert their kind. Signup becomes status=cast with personId set.
 * Caller must already have verified the signup and role ids belong to this production.
 */
export async function castSignup(opts: {
  orgId: string;
  signup: AuditionSignup;
  roleIds: string[];
  kind: "primary" | "understudy" | "swing";
  /** For copying the signup's structured conflicts into `conflicts`. */
  production: { id: string; closingDate: string | null };
  tz: string;
  createdByUserId?: string | null;
}): Promise<CastResult> {
  const { orgId, signup } = opts;
  return db.transaction(async (tx) => {
    const email = signup.email ? normalizeEmail(signup.email) : null;
    const isMinor = signup.age != null && signup.age < 18;

    let person: typeof people.$inferSelect | undefined;
    if (signup.personId) {
      [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, signup.personId), eq(people.orgId, orgId)));
    }
    if (!person && email) {
      [person] = await tx
        .select()
        .from(people)
        .where(
          and(
            eq(people.orgId, orgId),
            sql`lower(${people.email}) = ${email}`,
            sql`lower(${people.firstName}) = ${signup.firstName.trim().toLowerCase()}`,
          ),
        )
        .limit(1);
    }
    let createdPerson = false;
    if (!person) {
      [person] = await tx
        .insert(people)
        .values({
          orgId,
          firstName: signup.firstName.trim(),
          lastName: signup.lastName.trim(),
          email,
          phone: signup.phone,
          isMinor,
          birthYear: signup.age != null ? new Date().getFullYear() - signup.age : null,
        })
        .returning();
      createdPerson = true;
    }

    let guardian: CastResult["guardian"] = null;
    const gEmail = signup.guardianEmail ? normalizeEmail(signup.guardianEmail) : null;
    const gName = signup.guardianName?.trim() || null;
    if (gEmail || gName) {
      let g: typeof people.$inferSelect | undefined;
      if (gEmail) {
        // Prefer the person who is already somebody's guardian, then any person with that email.
        const candidates = await tx
          .select({ p: people, isGuardian: sql<boolean>`exists (select 1 from ${guardianships} where ${guardianships.guardianId} = ${people.id})` })
          .from(people)
          .where(and(eq(people.orgId, orgId), sql`lower(${people.email}) = ${gEmail}`, ne(people.id, person.id)));
        g = (candidates.find((c) => c.isGuardian) ?? candidates[0])?.p;
      }
      let created = false;
      if (!g) {
        const { firstName, lastName } = splitName(gName ?? gEmail ?? "Guardian");
        [g] = await tx
          .insert(people)
          .values({ orgId, firstName, lastName, email: gEmail, phone: signup.guardianPhone })
          .returning();
        created = true;
      }
      if (g.id !== person.id) {
        await tx.insert(guardianships).values({ guardianId: g.id, minorId: person.id }).onConflictDoNothing();
        guardian = { personId: g.id, name: fullName(g), email: g.email, created };
      }
    }

    for (const roleId of opts.roleIds) {
      await tx
        .insert(roleAssignments)
        .values({ roleId, personId: person.id, kind: opts.kind })
        .onConflictDoUpdate({ target: [roleAssignments.roleId, roleAssignments.personId], set: { kind: opts.kind } });
    }

    // Audition conflicts become real conflicts for this production, so the schedule builder warns on them.
    let conflictsAdded = 0;
    const expanded = expandConflicts(signup.conflictDates ?? [], opts.tz, opts.production.closingDate);
    if (expanded.length) {
      const existing = await tx
        .select({ startsAt: conflicts.startsAt, endsAt: conflicts.endsAt })
        .from(conflicts)
        .where(and(eq(conflicts.personId, person.id), eq(conflicts.productionId, opts.production.id)));
      const seen = new Set(existing.map((c) => `${c.startsAt.getTime()}-${c.endsAt.getTime()}`));
      const fresh = expanded.filter((c) => !seen.has(`${c.startsAt.getTime()}-${c.endsAt.getTime()}`));
      if (fresh.length) {
        await tx.insert(conflicts).values(
          fresh.map((c) => ({
            personId: person.id,
            productionId: opts.production.id,
            startsAt: c.startsAt,
            endsAt: c.endsAt,
            note: c.note ? `${c.note} (from audition)` : "From audition form",
            createdByUserId: opts.createdByUserId ?? null,
          })),
        );
        conflictsAdded = fresh.length;
      }
    }

    await tx
      .update(auditionSignups)
      .set({ status: "cast", personId: person.id })
      .where(eq(auditionSignups.id, signup.id));

    return { personId: person.id, personName: fullName(person), createdPerson, guardian, conflictsAdded };
  });
}

/** Role assignments in this production for the given people. */
export async function getProductionAssignments(productionId: string, personIds?: string[]) {
  if (personIds && personIds.length === 0) return [];
  return db
    .select({ personId: roleAssignments.personId, roleId: roles.id, roleName: roles.name, kind: roleAssignments.kind })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roles.productionId, productionId), personIds ? inArray(roleAssignments.personId, personIds) : undefined))
    .orderBy(asc(roles.sortOrder));
}

/* ───────────────────────── ICS ───────────────────────── */

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);

/** Fold content lines at 75 octets (RFC 5545), never splitting a multi-byte character. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(events: { uid: string; start: Date; end: Date; summary: string; location?: string | null; description?: string | null }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Calltime//Auditions//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@calltime`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Request-time clock for server components (keeps Date.now out of render bodies for the purity lint). */
export const nowMs = () => Date.now();

/** Statuses that mean a decision is still pending. */
export const PENDING_STATUSES: SignupStatus[] = ["registered", "checked_in", "auditioned", "callback"];

/**
 * Casting results are shown to families only once staff finalize the list ("Mark remaining as not
 * cast" leaves nobody pending). Until then, cast/not-cast signups read as "Auditioned" publicly.
 */
export async function resultsAreFinal(auditionId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), inArray(auditionSignups.status, PENDING_STATUSES)));
  return row.n === 0;
}

/** What a family sees for a signup's status. */
export function publicStatus(status: SignupStatus, final: boolean): { label: string; tone: (typeof STATUS_TONE)[SignupStatus] } {
  if ((status === "cast" || status === "not_cast") && !final) return { label: "Auditioned", tone: "neutral" };
  if (status === "registered") return { label: "Signed up", tone: "neutral" };
  if (status === "not_cast") return { label: "Not cast this time", tone: "neutral" };
  return { label: STATUS_LABEL[status], tone: STATUS_TONE[status] };
}

/* ───────────────────────── Structured conflicts ───────────────────────── */

export type AuditionConflict = AuditionSignup["conflictDates"][number];

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const conflictRow = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date for each conflict"),
    allDay: z.boolean(),
    start: z.string().optional(),
    end: z.string().optional(),
    weekly: z.boolean().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .transform((c, ctx) => {
    const note = c.note || undefined;
    const weekly = c.weekly || undefined;
    if (c.allDay) return { date: c.date, allDay: true, weekly, note } as AuditionConflict;
    if (!c.start || !c.end || !hhmm.test(c.start) || !hhmm.test(c.end)) {
      ctx.addIssue({ code: "custom", message: "Add a start and end time, or choose “All day”" });
      return z.NEVER;
    }
    if (c.end <= c.start) {
      ctx.addIssue({ code: "custom", message: "A conflict's end time must be after its start time" });
      return z.NEVER;
    }
    return { date: c.date, allDay: false, start: c.start, end: c.end, weekly, note } as AuditionConflict;
  });

/** Parse the picker's JSON. Returns the cleaned rows or a plain-words error. */
export function parseConflictDates(raw: string): { ok: AuditionConflict[] } | { error: string } {
  if (!raw) return { ok: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "We couldn't read the conflict dates. Please re-enter them." };
  }
  // Drop untouched blank rows rather than complaining about them.
  if (Array.isArray(data)) data = data.filter((r) => r && typeof r === "object" && (r as { date?: string }).date);
  const parsed = z.array(conflictRow).max(40, "That's a lot of conflicts — list the rest in the notes box").safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return { ok: parsed.data.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? ""))) };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar-date arithmetic on "yyyy-MM-dd" strings (UTC math, so no server-timezone drift). */
function ymd(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const ymdStr = (d: Date) => d.toISOString().slice(0, 10);

function fmtClock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Tue, Oct 21" / "Every Tue from Oct 21" + " · 3:00–5:00 PM" or " · All day". */
export function fmtConflict(c: AuditionConflict) {
  const d = ymd(c.date);
  const day = c.weekly
    ? `Every ${WEEKDAY[d.getUTCDay()]} from ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`
    : `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  let time = "All day";
  if (!c.allDay && c.start && c.end) {
    const a = fmtClock(c.start);
    const b = fmtClock(c.end);
    time = a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  }
  return `${day} · ${time}`;
}

/** "Oct 19 – Nov 22" for the production's rehearsal-to-closing range, if known. */
export function fmtDateRange(from: string | null, to: string | null) {
  const f = (s: string) => {
    const d = ymd(s);
    return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  if (from && to) return `${f(from)} – ${f(to)}`;
  if (from) return `from ${f(from)}`;
  if (to) return `through ${f(to)}`;
  return null;
}

/**
 * Concrete instants for each conflict in the org timezone. Weekly rows repeat until `until`
 * (the production's closing date) or 16 weeks, whichever is known.
 */
export function expandConflicts(list: AuditionConflict[], tz: string, until?: string | null) {
  const out: { startsAt: Date; endsAt: Date; note: string | null }[] = [];
  for (const c of list) {
    const first = ymd(c.date);
    const last = c.weekly ? (until ? ymd(until) : new Date(first.getTime() + 16 * 7 * 86400_000)) : first;
    for (let d = first, n = 0; d <= last && n < 60; d = new Date(d.getTime() + 7 * 86400_000), n++) {
      const day = ymdStr(d);
      const startsAt = fromLocalInput(day, tz, c.allDay ? "00:00" : c.start!);
      const endsAt = c.allDay ? fromLocalInput(ymdStr(new Date(d.getTime() + 86400_000)), tz, "00:00") : fromLocalInput(day, tz, c.end!);
      out.push({ startsAt, endsAt, note: c.note ?? null });
      if (!c.weekly) break;
    }
  }
  return out;
}

/** Conflicts (expanded) that overlap [start, end). */
export function clashes(list: AuditionConflict[], tz: string, start: Date, end: Date, until?: string | null) {
  return expandConflicts(list, tz, until).filter((c) => c.startsAt < end && c.endsAt > start);
}

/** Guidance sentence for the conflict picker, from the production's dates. */
export function seasonGuide(firstRehearsal: string | null, closingDate: string | null) {
  if (firstRehearsal && closingDate) return `Rehearsals and performances run ${fmtDateRange(firstRehearsal, closingDate)}`;
  if (closingDate) return `The show runs ${fmtDateRange(null, closingDate)}`;
  if (firstRehearsal) return `Rehearsals start ${fmtDateRange(firstRehearsal, null)!.replace(/^from /, "")}`;
  return null;
}
