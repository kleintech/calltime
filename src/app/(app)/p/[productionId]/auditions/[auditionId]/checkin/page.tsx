import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { Check, Search, UserCheck } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { fullName, getAuditionForProduction, getSlotsWithCounts, nowMs, type AuditionSignup } from "@/lib/auditions";
import { dayKey, fmtDay, fmtDayLong, fmtRange } from "@/lib/time";
import { Badge, EmptyState, Input, SectionTitle, buttonClass, cn } from "@/components/ui";
import { setSignupStatus } from "../../actions";
import { StatusBadge } from "../../_components/signup-bits";

function CheckInRow({ s, ids, when }: { s: AuditionSignup; ids: { productionId: string; auditionId: string }; when?: string }) {
  const done = s.status !== "registered";
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", done && "bg-success-soft/40")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-semibold">{fullName(s)}</div>
        <div className="truncate text-sm text-muted">
          {when ? `${when} · ` : ""}
          {s.age != null ? `Age ${s.age}` : ""}
          {s.guardianName ? ` · ${s.guardianName}` : ""}
        </div>
      </div>
      <form action={setSignupStatus} className="shrink-0">
        <input type="hidden" name="productionId" value={ids.productionId} />
        <input type="hidden" name="auditionId" value={ids.auditionId} />
        <input type="hidden" name="signupId" value={s.id} />
        {s.status === "registered" ? (
          <button name="status" value="checked_in" className={buttonClass("primary", "min-h-14 min-w-32 text-base")}>
            <UserCheck className="size-5" /> Check in
          </button>
        ) : s.status === "checked_in" ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-semibold text-success">
              <Check className="size-5" /> In
            </span>
            <button name="status" value="registered" className={buttonClass("ghost", "min-h-11 px-3 text-xs text-muted")}>
              Undo
            </button>
          </div>
        ) : (
          <StatusBadge status={s.status} />
        )}
      </form>
    </div>
  );
}

export default async function CheckInPage({ params, searchParams }: PageProps<"/p/[productionId]/auditions/[auditionId]/checkin">) {
  const { productionId, auditionId } = await params;
  const sp = await searchParams;
  const { org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  await getAuditionForProduction(productionId, auditionId);
  const slots = (await getSlotsWithCounts(auditionId)).filter((s) => s.kind === "audition");
  const days = [...new Set(slots.map((s) => dayKey(s.startsAt, tz)))];
  const today = dayKey(new Date(), tz);
  const requested = typeof sp.day === "string" && days.includes(sp.day) ? sp.day : null;
  const day = requested ?? (days.includes(today) ? today : (days.find((d) => d > today) ?? days[days.length - 1]));

  if (!day) {
    return <EmptyState title="No audition slots" body="Add slots first; check-in lists each day's slots in order." />;
  }

  const daySlots = slots.filter((s) => dayKey(s.startsAt, tz) === day);
  const signups = await db
    .select()
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), ne(auditionSignups.status, "withdrawn")))
    .orderBy(asc(auditionSignups.lastName));
  const bySlot = new Map<string, AuditionSignup[]>();
  for (const s of signups) if (s.slotId) bySlot.set(s.slotId, [...(bySlot.get(s.slotId) ?? []), s]);
  const dayPeople = daySlots.flatMap((sl) => bySlot.get(sl.id) ?? []);
  const checkedIn = dayPeople.filter((s) => s.status !== "registered").length;
  const unslotted = await db
    .select()
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), isNull(auditionSignups.slotId), ne(auditionSignups.status, "withdrawn")));
  const ids = { productionId, auditionId };
  const base = `/p/${productionId}/auditions/${auditionId}/checkin`;
  const now = nowMs();
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const slotById = new Map(slots.map((sl) => [sl.id, sl]));
  const matches = q ? signups.filter((s) => `${fullName(s)} ${s.guardianName ?? ""}`.toLowerCase().includes(q)) : [];

  return (
    <div>
      {days.length > 1 ? (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {days.map((d) => {
            const first = slots.find((s) => dayKey(s.startsAt, tz) === d)!;
            return (
              <Link
                key={d}
                href={`${base}?day=${d}`}
                className={cn(
                  "flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium",
                  d === day ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted",
                )}
              >
                {d === today ? "Today" : fmtDay(first.startsAt, tz)}
              </Link>
            );
          })}
        </div>
      ) : null}

      <form action={base} className="relative mb-4">
        <input type="hidden" name="day" value={day} />
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input name="q" type="search" defaultValue={q} placeholder="Find by name" aria-label="Find by name" className="pl-9" />
      </form>

      {q ? (
        <section className="mb-6">
          <SectionTitle
            action={
              <Link href={`${base}?day=${day}`} className="text-sm text-accent">
                Clear
              </Link>
            }
          >
            {matches.length} match{matches.length === 1 ? "" : "es"} for “{q}”
          </SectionTitle>
          {matches.length ? (
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {matches.map((s) => {
                const sl = s.slotId ? slotById.get(s.slotId) : undefined;
                return (
                  <CheckInRow
                    key={s.id}
                    s={s}
                    ids={ids}
                    when={sl ? `${fmtDay(sl.startsAt, tz)} ${fmtRange(sl.startsAt, sl.endsAt, tz)}` : "No slot"}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">Nobody by that name. They may be a walk-in: add them from the public signup link.</p>
          )}
        </section>
      ) : null}

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{day === today ? "Today" : "Not today"}</p>
          <p className="font-display text-xl font-semibold">{fmtDayLong(daySlots[0].startsAt, tz)}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-semibold tabular-nums">
            {checkedIn}
            <span className="text-lg text-muted">/{dayPeople.length}</span>
          </p>
          <p className="text-xs text-muted">checked in</p>
        </div>
      </div>

      <div className="space-y-4">
        {daySlots.map((sl) => {
          const people = bySlot.get(sl.id) ?? [];
          const isNow = sl.startsAt.getTime() <= now && sl.endsAt.getTime() > now;
          return (
            <section
              key={sl.id}
              className={cn("overflow-hidden rounded-2xl border bg-surface", isNow ? "border-accent ring-2 ring-accent/20" : "border-line")}
            >
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-4 py-2">
                <span className="font-semibold tabular-nums">{fmtRange(sl.startsAt, sl.endsAt, tz)}</span>
                <span className="flex items-center gap-2 text-sm text-muted">
                  {isNow ? <Badge tone="accent">Now</Badge> : null}
                  {sl.label ?? ""} {people.length}/{sl.capacity}
                </span>
              </div>
              {people.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">Nobody booked</p>
              ) : (
                <div className="divide-y divide-line">
                  {people.map((s) => (
                    <CheckInRow key={s.id} s={s} ids={ids} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {unslotted.length ? (
        <>
          <SectionTitle>No slot / walk-ins</SectionTitle>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {unslotted.map((s) => (
              <CheckInRow key={s.id} s={s} ids={ids} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
