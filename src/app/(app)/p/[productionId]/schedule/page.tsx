import { and, asc, count, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { CalendarPlus, ChevronRight, CopyPlus, MapPin, Send, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { events, people } from "@/db/schema";
import { Badge, EmptyState, LinkButton, cn } from "@/components/ui";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { buildCallSheets, loadCastIndex } from "@/lib/calls";
import { blockSummary, getConflictsFor } from "@/lib/schedule";
import { overlaps, weekKey } from "@/lib/schedule-shared";
import { dayKey, fmtDay, fmtRange, fmtTime, startOfLocalDay } from "@/lib/time";
import { duplicateWeek, publishAllDrafts } from "./actions";
import { ActionButton } from "./_components/action-button";
import { KindIcon, PersonChip, StatusBadges } from "./_components/bits";

export default async function SchedulePage({ params, searchParams }: PageProps<"/p/[productionId]/schedule">) {
  const { productionId } = await params;
  const sp = await searchParams;
  const past = sp.past === "1";
  const mineOnly = sp.mine === "1";
  const { user, org, canEdit, production } = await requireProductionAccess(productionId);
  const tz = org.timezone;
  const base = `/p/${productionId}/schedule`;
  const now = new Date();
  const todayStart = startOfLocalDay(now, tz);

  const conds = [eq(events.productionId, productionId)];
  if (!canEdit) conds.push(ne(events.status, "draft"));
  conds.push(past ? lt(events.endsAt, todayStart) : gte(events.endsAt, todayStart));
  const rows = await db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(past ? desc(events.startsAt) : asc(events.startsAt))
    .limit(past ? 150 : 400);

  const idx = await loadCastIndex(productionId);
  const sheets = await buildCallSheets(idx, rows);

  const covered = (await getCoveredPersonIds(user.id)).filter((id) => idx.allCast.has(id));
  const coveredPeople = covered.length ? await db.select().from(people).where(inArray(people.id, covered)) : [];
  coveredPeople.sort((a, b) => a.firstName.localeCompare(b.firstName));

  const [{ drafts }] = canEdit
    ? await db
        .select({ drafts: count() })
        .from(events)
        .where(and(eq(events.productionId, productionId), eq(events.status, "draft")))
    : [{ drafts: 0 }];

  // Editors: how many called people have a conflict overlapping one of their blocks, per event
  const conflictCount = new Map<string, number>();
  if (canEdit && rows.length) {
    const from = new Date(Math.min(...rows.map((r) => r.startsAt.getTime())));
    const to = new Date(Math.max(...rows.map((r) => r.endsAt.getTime())));
    const cs = await getConflictsFor([...idx.allCast], productionId, from, to);
    for (const sh of sheets) {
      if (sh.event.status === "cancelled") continue;
      const who = new Set<string>();
      for (const c of cs)
        if (sh.blocks.some((b) => b.personIds.has(c.personId) && overlaps(b.startsAt, b.endsAt, c.startsAt, c.endsAt))) who.add(c.personId);
      if (who.size) conflictCount.set(sh.event.id, who.size);
    }
  }

  const visible = sheets.filter((s) => !mineOnly || coveredPeople.some((p) => s.calls.has(p.id)));

  // Group: week (Monday start, org tz) → day → events
  type Sheet = (typeof sheets)[number];
  const weeks = new Map<string, Map<string, Sheet[]>>();
  for (const s of visible) {
    const wk = weekKey(s.event.startsAt, tz);
    const dk = dayKey(s.event.startsAt, tz);
    const days = weeks.get(wk) ?? new Map<string, Sheet[]>();
    const arr = days.get(dk) ?? [];
    arr.push(s);
    days.set(dk, arr);
    weeks.set(wk, days);
  }
  const thisWeek = weekKey(now, tz);
  const firstDraftWeek = canEdit && !past ? visible.find((s) => s.event.status === "draft") : undefined;
  const todayKey = dayKey(now, tz);
  const weekLabel = (wk: string) => {
    if (wk === thisWeek) return "This week";
    const diff = Math.round((Date.parse(wk) - Date.parse(thisWeek)) / 86400_000);
    if (diff === 7) return "Next week";
    if (diff === -7) return "Last week";
    return `Week of ${fmtDay(`${wk}T12:00:00Z`, "UTC").slice(5)}`;
  };

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={cn(
        "flex min-h-9 items-center rounded-lg px-3 text-sm font-medium",
        active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
  const qs = (p: { past?: boolean; mine?: boolean }) => {
    const q = new URLSearchParams();
    if (p.past) q.set("past", "1");
    if (p.mine) q.set("mine", "1");
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {tab(qs({ mine: mineOnly }), "Upcoming", !past)}
          {tab(qs({ past: true, mine: mineOnly }), "Past", past)}
        </div>
        {coveredPeople.length > 0 ? (
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {tab(qs({ past }), "Everything", !mineOnly)}
            {tab(qs({ past, mine: true }), coveredPeople.length > 1 ? "Our calls" : "My calls", mineOnly)}
          </div>
        ) : null}
        {canEdit ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <LinkButton href={`${base}/new`} className="flex-1 sm:flex-none">
              <CalendarPlus className="size-4" /> New event
            </LinkButton>
            {drafts > 0 ? (
              <ActionButton
                action={publishAllDrafts.bind(null, productionId)}
                confirm={`Publish all ${drafts} draft event${drafts === 1 ? "" : "s"}? Cast and families will see them right away.`}
                pendingLabel="Publishing…"
                className="w-full sm:w-auto"
              >
                <Send className="size-4" /> Publish {drafts} draft{drafts === 1 ? "" : "s"}
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {firstDraftWeek ? (
        <a
          href={`#week-${weekKey(firstDraftWeek.event.startsAt, tz)}`}
          className="mb-4 flex min-h-11 items-center gap-2 rounded-xl bg-warn-soft px-4 text-sm text-warn"
        >
          <span className="flex-1">
            Drafts start {fmtDay(firstDraftWeek.event.startsAt, tz)} — families can&apos;t see them yet.
          </span>
          <span className="font-semibold">Jump there ↓</span>
        </a>
      ) : null}
      {coveredPeople.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Call times shown for</span>
          {coveredPeople.map((p) => (
            <PersonChip key={p.id} name={p.firstName} />
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={past ? "No past events" : mineOnly ? "No upcoming calls" : "Nothing scheduled yet"}
          body={
            canEdit && !past
              ? "Add your first rehearsal: pick the scenes you're working and everyone in them is called automatically."
              : past
                ? "Events show up here once they're over."
                : "When the creative team publishes the schedule, it'll show up here."
          }
          action={canEdit && !past ? <LinkButton href={`${base}/new`}>New event</LinkButton> : undefined}
        />
      ) : (
        <div className="space-y-8">
          {[...weeks.entries()].map(([wk, days]) => {
            const weekEvents = [...days.values()].flat().filter((s) => s.event.status !== "cancelled").length;
            return (
              <section key={wk} id={`week-${wk}`} className="scroll-mt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">{weekLabel(wk)}</h2>
                  {canEdit && weekEvents > 0 ? (
                    <ActionButton
                      action={duplicateWeek.bind(null, productionId, wk)}
                      confirm={`Copy this week's ${weekEvents} event${weekEvents === 1 ? "" : "s"} to the following week as drafts?`}
                      pendingLabel="Copying…"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs text-muted"
                      doneMessage="Copied {count} as drafts"
                    >
                      <CopyPlus className="size-4" /> Copy to next week
                    </ActionButton>
                  ) : null}
                </div>
                <div className="space-y-4">
                  {[...days.entries()].map(([dk, list]) => (
                    <div key={dk}>
                      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                        {fmtDay(list[0].event.startsAt, tz)}
                        {dk === todayKey ? <Badge tone="accent">Today</Badge> : null}
                      </h3>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {list.map((s) => {
                          const ev = s.event;
                          const cancelled = ev.status === "cancelled";
                          const summary = blockSummary(idx, s.blocks);
                          const myCalls = coveredPeople.filter((p) => s.calls.has(p.id));
                          const done = !past && ev.endsAt < now;
                          const nConf = conflictCount.get(ev.id) ?? 0;
                          return (
                            <Link
                              key={ev.id}
                              href={`${base}/${ev.id}`}
                              className={cn(
                                "group flex gap-3 rounded-2xl border bg-surface p-3.5 transition hover:bg-surface-2",
                                done && "opacity-60",
                                ev.status === "draft" ? "border-dashed border-warn/60" : "border-line",
                                myCalls.length > 0 && !cancelled && "border-l-4 border-l-accent",
                              )}
                            >
                              <KindIcon kind={ev.kind} color={cancelled ? undefined : production.accentColor} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className={cn("font-semibold leading-snug", cancelled && "text-muted line-through")}>{ev.title}</p>
                                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                    {done ? <Badge>Done</Badge> : null}
                                    <StatusBadges event={ev} tz={tz} now={now} />
                                  </div>
                                </div>
                                <p className={cn("text-sm text-muted", cancelled && "line-through")}>
                                  {fmtRange(ev.startsAt, ev.endsAt, tz)}
                                  {ev.location ? (
                                    <>
                                      {" · "}
                                      <MapPin className="mb-0.5 inline size-3.5" /> {ev.location}
                                    </>
                                  ) : null}
                                </p>
                                {summary ? <p className="mt-1 line-clamp-2 text-sm">{summary}</p> : null}
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {myCalls.map((p) => {
                                    const c = s.calls.get(p.id)!;
                                    return (
                                      <PersonChip key={p.id} name={p.firstName} className={cancelled ? "opacity-60" : undefined}>
                                        {p.firstName} {fmtRange(c.callAt, c.releaseAt, tz)}
                                      </PersonChip>
                                    );
                                  })}
                                  {coveredPeople.length > 0 && myCalls.length === 0 && !canEdit ? (
                                    <span className="text-xs text-muted">
                                      Not called{coveredPeople.length > 1 ? ` (${coveredPeople.map((p) => p.firstName).join(", ")})` : ""}
                                    </span>
                                  ) : null}
                                  {canEdit ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                                      <Users className="size-3.5" /> {s.calls.size} called
                                      {s.blocks.length > 1 ? ` · ${s.blocks.length} blocks` : ""}
                                      {s.blocks.length > 0 ? ` · first call ${fmtTime(s.blocks[0].startsAt, tz)}` : ""}
                                    </span>
                                  ) : null}
                                  {nConf ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
                                      <TriangleAlert className="size-3.5" /> {nConf} conflict{nConf === 1 ? "" : "s"}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <ChevronRight className="mt-2.5 size-4 shrink-0 self-start text-muted opacity-0 transition group-hover:opacity-100" />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {coveredPeople.length > 0 && !canEdit ? (
        <p className="mt-8 text-center text-sm text-muted">
          Can&apos;t make a rehearsal?{" "}
          <Link href="/home/conflicts" className="font-medium text-accent">
            Report a conflict
          </Link>
        </p>
      ) : null}
    </div>
  );
}
