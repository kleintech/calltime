"use server";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditionSignups, auditionSlots, auditions, invites, people, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import {
  castSignup,
  fullName,
  isUuid,
  moveSignupSlot,
  SIGNUP_STATUSES,
  uniqueSlug,
  type AuditionQuestion,
} from "@/lib/auditions";
import { createInvite, inviteUrl } from "@/lib/invites";
import { fromLocalInput } from "@/lib/time";

/* ───────── helpers ───────── */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

async function editorCtx(fd: FormData) {
  const productionId = str(fd, "productionId");
  if (!isUuid(productionId)) throw new Error("Bad production");
  const ctx = await requireProductionEditor(productionId);
  return { ...ctx, productionId };
}

/** Editor + an audition that belongs to the authorized production. */
async function auditionCtx(fd: FormData) {
  const ctx = await editorCtx(fd);
  const auditionId = str(fd, "auditionId");
  if (!isUuid(auditionId)) throw new Error("Bad audition");
  const audition = await db.query.auditions.findFirst({
    where: and(eq(auditions.id, auditionId), eq(auditions.productionId, ctx.productionId)),
  });
  if (!audition) throw new Error("Audition not found");
  return { ...ctx, audition, tz: ctx.org.timezone };
}

/** Signup that belongs to the authorized audition. */
async function signupCtx(fd: FormData) {
  const ctx = await auditionCtx(fd);
  const signupId = str(fd, "signupId");
  if (!isUuid(signupId)) throw new Error("Bad signup");
  const signup = await db.query.auditionSignups.findFirst({
    where: and(eq(auditionSignups.id, signupId), eq(auditionSignups.auditionId, ctx.audition.id)),
  });
  if (!signup) throw new Error("Signup not found");
  return { ...ctx, signup };
}

/** Keep only role ids that belong to this production. */
async function productionRoleIds(productionId: string, ids: string[]) {
  const clean = ids.filter(isUuid);
  if (clean.length === 0) return [];
  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.productionId, productionId), inArray(roles.id, clean)));
  return rows.map((r) => r.id);
}

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}/auditions`, "layout");
}

const questionsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(64),
      label: z.string().trim().min(1).max(300),
      type: z.enum(["text", "textarea", "checkbox"]),
    }),
  )
  .max(30);

function parseQuestions(raw: string): AuditionQuestion[] {
  if (!raw) return [];
  try {
    const parsed = questionsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.filter((q) => q.label);
  } catch {
    return [];
  }
}

export type FormState = { error?: string; ok?: string };

/* ───────── auditions ───────── */

const auditionSchema = z.object({
  title: z.string().trim().min(1, "Give the audition a title.").max(200),
  description: z.string().trim().max(5000).nullable(),
  location: z.string().trim().max(300).nullable(),
});

export async function createAudition(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await editorCtx(fd);
  const parsed = auditionSchema.safeParse({ title: str(fd, "title"), description: opt(fd, "description"), location: opt(fd, "location") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const slug = await uniqueSlug(str(fd, "slug") || `${ctx.production.title} ${parsed.data.title}`);
  const [row] = await db
    .insert(auditions)
    .values({
      productionId: ctx.productionId,
      ...parsed.data,
      slug,
      isOpen: fd.get("isOpen") === "on",
      questions: parseQuestions(str(fd, "questions")),
    })
    .returning();
  revalidate(ctx.productionId);
  redirect(`/p/${ctx.productionId}/auditions/${row.id}/slots`);
}

export async function updateAudition(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await auditionCtx(fd);
  const parsed = auditionSchema.safeParse({ title: str(fd, "title"), description: opt(fd, "description"), location: opt(fd, "location") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const wantedSlug = str(fd, "slug");
  let slug = ctx.audition.slug;
  if (wantedSlug && wantedSlug !== ctx.audition.slug) slug = await uniqueSlug(wantedSlug, ctx.audition.id);
  await db
    .update(auditions)
    .set({ ...parsed.data, slug, isOpen: fd.get("isOpen") === "on", questions: parseQuestions(str(fd, "questions")) })
    .where(eq(auditions.id, ctx.audition.id));
  revalidate(ctx.productionId);
  return { ok: slug !== wantedSlug && wantedSlug ? `Saved. That link was taken, so it's /audition/${slug}.` : "Saved." };
}

export async function toggleAuditionOpen(fd: FormData) {
  const ctx = await auditionCtx(fd);
  await db.update(auditions).set({ isOpen: !ctx.audition.isOpen }).where(eq(auditions.id, ctx.audition.id));
  revalidate(ctx.productionId);
}

export async function deleteAudition(fd: FormData) {
  const ctx = await auditionCtx(fd);
  await db.delete(auditions).where(eq(auditions.id, ctx.audition.id));
  revalidate(ctx.productionId);
  redirect(`/p/${ctx.productionId}/auditions`);
}

/* ───────── slots ───────── */

const kindSchema = z.enum(["audition", "callback"]);

export async function generateSlots(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await auditionCtx(fd);
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
      start: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time."),
      end: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time."),
      length: z.coerce.number().int().min(5, "Slots must be at least 5 minutes.").max(480),
      capacity: z.coerce.number().int().min(1).max(500),
      kind: kindSchema,
    })
    .safeParse({
      date: str(fd, "date"),
      start: str(fd, "start"),
      end: str(fd, "end"),
      length: str(fd, "length"),
      capacity: str(fd, "capacity"),
      kind: str(fd, "kind") || "audition",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { date, start, end, length, capacity, kind } = parsed.data;
  const from = fromLocalInput(date, ctx.tz, start);
  const to = fromLocalInput(date, ctx.tz, end);
  if (to <= from) return { error: "End time must be after the start time." };
  const rows: (typeof auditionSlots.$inferInsert)[] = [];
  for (let t = from.getTime(); t + length * 60_000 <= to.getTime(); t += length * 60_000) {
    rows.push({
      auditionId: ctx.audition.id,
      kind,
      startsAt: new Date(t),
      endsAt: new Date(t + length * 60_000),
      capacity,
      label: opt(fd, "label"),
      location: opt(fd, "location"),
    });
  }
  if (rows.length === 0) return { error: "That window is shorter than one slot." };
  if (rows.length > 200) return { error: "That would create more than 200 slots — try a longer slot length." };
  await db.insert(auditionSlots).values(rows);
  revalidate(ctx.productionId);
  return { ok: `Added ${rows.length} slot${rows.length === 1 ? "" : "s"}.` };
}

const slotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  start: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time."),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time."),
  capacity: z.coerce.number().int().min(1).max(500),
  kind: kindSchema,
});

function parseSlot(fd: FormData, tz: string) {
  const parsed = slotSchema.safeParse({
    date: str(fd, "date"),
    start: str(fd, "start"),
    end: str(fd, "end"),
    capacity: str(fd, "capacity"),
    kind: str(fd, "kind") || "audition",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message } as const;
  const startsAt = fromLocalInput(parsed.data.date, tz, parsed.data.start);
  const endsAt = fromLocalInput(parsed.data.date, tz, parsed.data.end);
  if (endsAt <= startsAt) return { error: "End time must be after the start time." } as const;
  return {
    values: { startsAt, endsAt, capacity: parsed.data.capacity, kind: parsed.data.kind, label: opt(fd, "label"), location: opt(fd, "location") },
  } as const;
}

export async function addSlot(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await auditionCtx(fd);
  const r = parseSlot(fd, ctx.tz);
  if ("error" in r) return { error: r.error };
  await db.insert(auditionSlots).values({ auditionId: ctx.audition.id, ...r.values });
  revalidate(ctx.productionId);
  return { ok: "Slot added." };
}

export async function updateSlot(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await auditionCtx(fd);
  const slotId = str(fd, "slotId");
  if (!isUuid(slotId)) return { error: "Bad slot" };
  const r = parseSlot(fd, ctx.tz);
  if ("error" in r) return { error: r.error };
  await db
    .update(auditionSlots)
    .set(r.values)
    .where(and(eq(auditionSlots.id, slotId), eq(auditionSlots.auditionId, ctx.audition.id)));
  revalidate(ctx.productionId);
  return { ok: "Saved." };
}

export async function deleteSlot(fd: FormData) {
  const ctx = await auditionCtx(fd);
  const slotId = str(fd, "slotId");
  if (!isUuid(slotId)) throw new Error("Bad slot");
  await db.delete(auditionSlots).where(and(eq(auditionSlots.id, slotId), eq(auditionSlots.auditionId, ctx.audition.id)));
  revalidate(ctx.productionId);
}

/* ───────── signups ───────── */

export async function setSignupStatus(fd: FormData) {
  const ctx = await signupCtx(fd);
  const status = z.enum(SIGNUP_STATUSES as [string, ...string[]]).parse(str(fd, "status")) as (typeof SIGNUP_STATUSES)[number];
  await db.update(auditionSignups).set({ status }).where(eq(auditionSignups.id, ctx.signup.id));
  revalidate(ctx.productionId);
}

export async function moveSignup(fd: FormData) {
  const ctx = await signupCtx(fd);
  const slotId = str(fd, "slotId");
  const kind = kindSchema.parse(str(fd, "kind") || "audition");
  await moveSignupSlot({
    signupId: ctx.signup.id,
    auditionId: ctx.audition.id,
    slotId: isUuid(slotId) ? slotId : null,
    kind,
    enforceCapacity: false,
  });
  revalidate(ctx.productionId);
}

export async function saveReview(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await signupCtx(fd);
  await db.update(auditionSignups).set({ staffNotes: opt(fd, "staffNotes") }).where(eq(auditionSignups.id, ctx.signup.id));
  revalidate(ctx.productionId);
  return { ok: "Saved." };
}

export async function setRating(fd: FormData) {
  const ctx = await signupCtx(fd);
  const n = z.coerce.number().int().min(0).max(5).parse(str(fd, "rating"));
  await db
    .update(auditionSignups)
    .set({ rating: n === 0 || n === ctx.signup.rating ? null : n })
    .where(eq(auditionSignups.id, ctx.signup.id));
  revalidate(ctx.productionId);
}

/* ───────── callbacks ───────── */

export async function saveCallback(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await signupCtx(fd);
  const roleIds = await productionRoleIds(ctx.productionId, fd.getAll("roleIds").map(String));
  const slotId = str(fd, "callbackSlotId");
  await moveSignupSlot({
    signupId: ctx.signup.id,
    auditionId: ctx.audition.id,
    slotId: isUuid(slotId) ? slotId : null,
    kind: "callback",
    enforceCapacity: false,
  });
  await db
    .update(auditionSignups)
    .set({ callbackRoleIds: roleIds, status: ctx.signup.status === "cast" ? "cast" : "callback" })
    .where(eq(auditionSignups.id, ctx.signup.id));
  revalidate(ctx.productionId);
  return { ok: "Callback saved." };
}

/* ───────── casting ───────── */

export type InviteLink = { name: string; email: string; url: string; as: string };
export type CastState = { error?: string; ok?: string; warning?: string; invites?: InviteLink[] };

const castKind = z.enum(["primary", "understudy", "swing"]);

export async function castAction(_: CastState, fd: FormData): Promise<CastState> {
  const ctx = await signupCtx(fd);
  if (ctx.signup.status === "withdrawn") return { error: "This auditioner withdrew." };
  const roleIds = await productionRoleIds(ctx.productionId, fd.getAll("roleIds").map(String));
  if (roleIds.length === 0) return { error: "Pick at least one role." };
  const kind = castKind.parse(str(fd, "kind") || "primary");
  const result = await castSignup({
    orgId: ctx.org.id,
    signup: ctx.signup,
    roleIds,
    kind,
    production: { id: ctx.production.id, closingDate: ctx.production.closingDate },
    tz: ctx.tz,
    createdByUserId: ctx.user.id,
  });
  let invites: InviteLink[] | undefined;
  if (fd.get("invite") === "on") invites = await invitesFor(ctx, [ctx.signup.id]);
  revalidate(ctx.productionId);
  revalidatePath(`/p/${ctx.productionId}`, "layout");
  const g = result.guardian ? ` Guardian ${result.guardian.name} ${result.guardian.created ? "added" : "linked"}.` : "";
  const c = result.conflictsAdded ? ` ${result.conflictsAdded} conflict${result.conflictsAdded === 1 ? "" : "s"} added to the schedule.` : "";
  return {
    ok: `${result.personName} cast.${result.createdPerson ? " New person record created." : " Matched an existing person record."}${g}${c}`,
    warning: result.guardianWarning ?? undefined,
    invites,
  };
}

/** Reuse a still-pending invite for this person rather than minting duplicates on every click. */
async function inviteFor(ctx: Awaited<ReturnType<typeof auditionCtx>>, person: typeof people.$inferSelect & { email: string }) {
  const pending = await db.query.invites.findFirst({
    where: and(eq(invites.personId, person.id), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())),
  });
  if (pending) return inviteUrl(pending.token);
  const { url } = await createInvite({
    orgId: ctx.org.id,
    email: person.email,
    name: fullName(person),
    productionId: ctx.productionId,
    personId: person.id,
    invitedByUserId: ctx.user.id,
  });
  return url;
}

/** Invite links for the people (and guardians) behind cast signups who don't have an account yet. */
async function invitesFor(
  ctx: Awaited<ReturnType<typeof auditionCtx>>,
  signupIds: string[],
): Promise<InviteLink[]> {
  const signups = await db
    .select()
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, ctx.audition.id), inArray(auditionSignups.id, signupIds), eq(auditionSignups.status, "cast")));
  const out: InviteLink[] = [];
  const seen = new Set<string>();
  for (const s of signups) {
    if (!s.personId) continue;
    const person = await db.query.people.findFirst({ where: and(eq(people.id, s.personId), eq(people.orgId, ctx.org.id)) });
    if (!person) continue;
    const guardians = await db.query.guardianships.findMany({
      where: (g, { eq: e }) => e(g.minorId, person.id),
      with: { guardian: true },
    });
    for (const { guardian } of guardians) {
      if (guardian.userId || !guardian.email || seen.has(guardian.id)) continue;
      seen.add(guardian.id);
      const url = await inviteFor(ctx, { ...guardian, email: guardian.email });
      out.push({ name: fullName(guardian), email: guardian.email, url, as: `Guardian of ${person.firstName}` });
    }
    // Performer's own account: adults always; minors 13+ only if they have their own email (younger kids go through guardians).
    const guardianEmails = new Set(guardians.map((g) => g.guardian.email?.toLowerCase()));
    const ownEmail = !!person.email && !guardianEmails.has(person.email.toLowerCase());
    const age = s.age ?? (person.birthYear ? new Date().getFullYear() - person.birthYear : null);
    const minorOk = ownEmail && age != null && age >= 13;
    if (!person.userId && person.email && (!person.isMinor || minorOk) && !seen.has(person.id)) {
      seen.add(person.id);
      const url = await inviteFor(ctx, { ...person, email: person.email });
      out.push({ name: fullName(person), email: person.email, url, as: "Performer" });
    }
  }
  return out;
}

export async function generateInvites(_: CastState, fd: FormData): Promise<CastState> {
  const ctx = await auditionCtx(fd);
  const ids = fd.getAll("signupIds").map(String).filter(isUuid);
  if (ids.length === 0) return { error: "Nobody cast yet." };
  const invites = await invitesFor(ctx, ids);
  if (invites.length === 0) return { ok: "Everyone cast already has an account (or no email on file)." };
  return { ok: `${invites.length} invite link${invites.length === 1 ? "" : "s"} created. Send each one to its person.`, invites };
}

export async function markRemainingNotCast(fd: FormData) {
  const ctx = await auditionCtx(fd);
  await db
    .update(auditionSignups)
    .set({ status: "not_cast" })
    .where(
      and(
        eq(auditionSignups.auditionId, ctx.audition.id),
        inArray(auditionSignups.status, ["registered", "checked_in", "auditioned", "callback"]),
      ),
    );
  revalidate(ctx.productionId);
}
