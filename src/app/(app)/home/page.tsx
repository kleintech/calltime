import { and, asc, count, desc, eq, gte, inArray, min, or } from "drizzle-orm";
import { Ban, CalendarClock, FolderOpen, HandHeart, Megaphone, NotebookPen, CalendarPlus, ChevronRight, ExternalLink, MapPin, RefreshCw, StickyNote, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { announcements, changeAcks, eventBlocks, eventChanges, events, organizations } from "@/db/schema";
import { Badge, CallTime, Card, Chip, cn, EmptyState, LinkButton, Ticket } from "@/components/ui";
import { getCoveredPersonIds, getUserProductions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { getCallsForPeople, type PersonCall } from "@/lib/calls";
import { getUnacknowledgedChanges } from "@/lib/changes";
import { getUnreadNoteCount } from "@/lib/notes";
import { mapsUrl, personColor } from "@/lib/schedule-shared";
import { dayKey, fmtDay, fmtDayLong, fmtRange, fmtTime, toDateInput, toTimeInput } from "@/lib/time";
import { weekKey } from "@/lib/schedule-shared";
import { GotItButton } from "./_components/got-it";
import { KindIcon, PersonChip, StatusBadges } from "../p/[productionId]/schedule/_components/bits";

type EventGroup = { key: string; tz: string; calls: PersonCall[] };

const listNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : (names[0] ?? "");

/**
 * Calls home: what families open most. Order (per docs/ux/GUIDELINES.md §2): changes/cancellations
 * strip → next call → calendar setup → coming up (by day) → can't-make-it entry → shows you run.
 */
export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();

  const covered = await getCoveredPersonIds(user.id);
  const allCalls = await getCallsForPeople(covered, { from: now });
  const productions = await getUserProductions(user);

  // Org timezone per production
  const orgIds = [...new Set([...allCalls.map((c) => c.production.orgId), ...productions.map((p) => p.production.orgId)])];
  const orgRows = orgIds.length ? await db.select().from(organizations).where(inArray(organizations.id, orgIds)) : [];
  const tzByOrg = new Map(orgRows.map((o) => [o.id, o.timezone]));
  const tzOf = (orgId: string) => tzByOrg.get(orgId) ?? "America/New_York";
  const homeTz = tzOf(orgIds[0] ?? "");

  const peopleById = new Map(allCalls.map((c) => [c.person.id, c.person]));
  const persons = [...peopleById.values()].sort((a, b) => a.firstName.localeCompare(b.firstName));
  const filter = typeof sp.p === "string" && peopleById.has(sp.p) ? sp.p : null;
  const calls = filter ? allCalls.filter((c) => c.person.id === filter) : allCalls;
  const multiProduction = new Set(allCalls.map((c) => c.production.id)).size > 1;

  // One card per event (a parent with two kids in one rehearsal sees one card, two rows)
  const byEvent = new Map<string, EventGroup>();
  for (const c of calls) {
    const g = byEvent.get(c.event.id) ?? { key: c.event.id, tz: tzOf(c.production.orgId), calls: [] };
    g.calls.push(c);
    byEvent.set(c.event.id, g);
  }
  const startOf = (g: EventGroup) => Math.min(...g.calls.map((c) => c.callAt.getTime()));
  const groups = [...byEvent.values()].sort((a, b) => startOf(a) - startOf(b));
  const next = groups.find((g) => g.calls[0].event.status !== "cancelled" && g.calls.some((c) => c.releaseAt > now));
  const rest = groups.filter((g) => g !== next);

  // Changes & cancellations this account hasn't acknowledged ("Got it"), shown above the hero.
  const unackedList = covered.length ? await getUnacknowledgedChanges(user.id) : [];
  const unacked = new Map(unackedList.map((u) => [u.event.id, u]));
  // Cancellations that predate change tracking (no change rows) still need surfacing once.
  const soon = now.getTime() + 14 * 86400_000;
  const legacyIds = groups
    .filter((g) => g.calls[0].event.status === "cancelled" && !unacked.has(g.key) && startOf(g) <= soon)
    .map((g) => g.key);
  const [legacyChanges, legacyAcks] = legacyIds.length
    ? await Promise.all([
        db.select({ eventId: eventChanges.eventId }).from(eventChanges).where(inArray(eventChanges.eventId, legacyIds)),
        db
          .select({ eventId: changeAcks.eventId })
          .from(changeAcks)
          .where(and(eq(changeAcks.userId, user.id), inArray(changeAcks.eventId, legacyIds))),
      ])
    : [[], []];
  const legacyCancelled = new Set(
    legacyIds.filter((id) => !legacyChanges.some((c) => c.eventId === id) && !legacyAcks.some((a) => a.eventId === id)),
  );
  const changedAt = (eventId: string) => {
    const u = unacked.get(eventId);
    return u ? u.changes.at(-1)!.createdAt : null;
  };
  // Built from the change list (not current calls) so someone dropped from an event still hears about it.
  type Alert = { eventId: string; productionId: string; title: string; at: Date; tz: string; cancelled: boolean; removed: boolean; who: string[]; lines: string[]; revision: number };
  const alerts: Alert[] = [
    ...unackedList
      .filter((u) => !filter || u.people.includes(peopleById.get(filter)?.firstName ?? ""))
      .map((u) => ({
        eventId: u.event.id,
        productionId: u.production.id,
        title: u.event.title,
        at: byEvent.get(u.event.id)?.calls[0].callAt ?? u.event.startsAt,
        tz: tzOf(u.production.orgId),
        cancelled: u.event.status === "cancelled",
        removed: u.event.status === "draft", // unpublished: families can't open it, so no link
        who: u.people,
        lines: u.changes.flatMap((c) => c.lines).slice(-4),
        revision: u.latestRevision,
      })),
    ...groups
      .filter((g) => legacyCancelled.has(g.key))
      .map((g) => ({
        eventId: g.key,
        productionId: g.calls[0].production.id,
        title: g.calls[0].event.title,
        at: g.calls[0].callAt,
        tz: g.tz,
        cancelled: true,
        removed: false,
        who: g.calls.map((c) => c.person.firstName),
        lines: [g.calls[0].event.changeNote ? `Cancelled — ${g.calls[0].event.changeNote}` : "Cancelled"],
        revision: g.calls[0].event.revision,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const relDay = (d: Date, tz: string) => {
    const k = dayKey(d, tz);
    const short = fmtDay(d, tz).replace(/^\w+, /, "");
    if (k === dayKey(now, tz)) return `Today · ${short}`;
    if (k === dayKey(new Date(now.getTime() + 86400_000), tz)) return `Tomorrow · ${short}`;
    return fmtDay(d, tz);
  };

  const days = new Map<string, { label: string; groups: EventGroup[] }>();
  for (const g of rest) {
    const first = g.calls[0];
    const k = dayKey(first.callAt, g.tz);
    const d = days.get(k) ?? { label: relDay(first.callAt, g.tz), groups: [] };
    d.groups.push(g);
    days.set(k, d);
  }

  // Announcements for the shows the user's people are in: pinned, or posted in the last 7 days
  const castProdIds = productions.filter((p) => p.relation === "cast" || allCalls.some((c) => c.production.id === p.production.id)).map((p) => p.production.id);
  const annRows = castProdIds.length
    ? await db
        .select()
        .from(announcements)
        .where(and(inArray(announcements.productionId, castProdIds), or(eq(announcements.pinned, true), gte(announcements.createdAt, new Date(now.getTime() - 7 * 86400_000)))))
        .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
        .limit(3)
    : [];
  const prodById = new Map(productions.map((p) => [p.production.id, p.production]));
  const unreadNotes = new Map(
    await Promise.all(castProdIds.map(async (id) => [id, await getUnreadNoteCount(user.id, id)] as const)),
  );

  const running = productions.filter((p) => (p.relation === "admin" || p.relation === "creative") && p.production.status !== "closed");
  const runningInfo = running.length ? await getRunningInfo(running, now) : { events: [], drafts: new Map<string, number>(), firstDraft: new Map<string, Date | null>() };

  const names = persons.map((p) => p.firstName);
  const onlySelf = persons.length === 1 && persons[0].userId === user.id;
  const title =
    persons.length === 0
      ? `Hi, ${user.name.split(" ")[0]}`
      : onlySelf
        ? "Your calls"
        : persons.length > 2
          ? "Your family's calls"
          : `${listNames(names)}'s calls`;
  const multi = persons.length > 1;

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-muted">{fmtDayLong(now, homeTz)}</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      </div>

      {multi ? (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Show calls for">
          <FilterChip href="/home" active={!filter} label="All" />
          {persons.map((p) => (
            <FilterChip key={p.id} href={`/home?p=${p.id}`} active={filter === p.id} label={p.firstName} color={personColor(p.firstName)} />
          ))}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <section className="mb-4 overflow-hidden rounded-2xl border border-warn/40 bg-warn-soft" aria-label="Changes">
          <p className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-warn">
            <TriangleAlert className="size-4" /> {alerts.length} {alerts.length === 1 ? "change" : "changes"} to check
          </p>
          <ul className="space-y-1 p-1.5">
            {alerts.map((a) => (
              <li key={a.eventId} className="rounded-xl bg-surface/70 p-3">
                {(() => {
                  const content = (
                    <>
                      {a.cancelled || a.removed ? <Ban className="mt-0.5 size-4 shrink-0 text-danger" /> : <RefreshCw className="mt-0.5 size-4 shrink-0 text-warn" />}
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">
                          {fmtDay(a.at, a.tz)} · {a.title}
                        </span>
                        {multi ? <span className="text-muted"> · {a.who.join(" & ")}</span> : null}
                        {a.cancelled ? <strong className="ml-1 text-danger">CANCELLED</strong> : a.removed ? <strong className="ml-1 text-danger">REMOVED</strong> : null}
                        {a.lines.map((t, i) => (
                          <span key={i} className="mt-0.5 block">
                            {t}
                          </span>
                        ))}
                      </span>
                    </>
                  );
                  return a.removed ? (
                    <div className="flex items-start gap-2 text-sm">{content}</div>
                  ) : (
                    <Link href={`/p/${a.productionId}/schedule/${a.eventId}`} className="flex items-start gap-2 text-sm">
                      {content}
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />
                    </Link>
                  );
                })()}
                <div className="mt-2 flex justify-end">
                  <GotItButton eventId={a.eventId} revision={a.revision} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {next ? (
        <HeroCard
          group={next}
          label={relDay(next.calls[0].callAt, next.tz)}
          multi={multi}
          now={now}
          changed={changedAt(next.key)}
          changes={unacked.get(next.key)?.changes.flatMap((c) => c.lines) ?? []}
          cancelledSameDay={groups.filter(
            (g) => g.calls[0].event.status === "cancelled" && dayKey(g.calls[0].callAt, g.tz) === dayKey(next.calls[0].callAt, next.tz),
          )}
        />
      ) : null}

      {covered.length > 0 && !next && rest.length === 0 ? (
        <EmptyState
          title="No upcoming calls"
          body={
            filter
              ? "Nothing scheduled for this person right now."
              : "When the director publishes the rehearsal schedule, calls show up here and in your calendar."
          }
        />
      ) : null}

      {covered.length > 0 ? (
        <Link href="/home/calendar" className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
            <CalendarPlus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Add to my calendar</span>
            <span className="block text-sm text-muted">
              Get {onlySelf || names.length === 0 ? "your" : `${listNames(names)}'s`} calls in your phone&apos;s calendar. Updates automatically.
            </span>
          </span>
          <ChevronRight className="size-4 text-muted" />
        </Link>
      ) : null}

      {castProdIds.length > 0 ? (
        <nav className="mt-3 space-y-3" aria-label="Show resources">
          {castProdIds.map((id) => {
            const n = unreadNotes.get(id) ?? 0;
            const prod = prodById.get(id);
            const tile =
              "relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-line/80 bg-surface px-2 py-2.5 text-center text-sm font-medium text-ink shadow-card transition-[box-shadow,transform] duration-200 hover:shadow-raised active:scale-[.98] [&_svg]:size-5 [&_svg]:text-muted";
            return (
              <div key={id}>
                {castProdIds.length > 1 ? (
                  <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.08em] text-muted">
                    {prod?.accentColor ? <span aria-hidden className="size-2 rounded-full" style={{ background: prod.accentColor }} /> : null}
                    {prod?.title}
                  </p>
                ) : null}
                <div className="grid grid-cols-3 gap-2">
                  <Link
                    href={`/p/${id}/notes`}
                    className={cn(tile, n > 0 && "border-accent/40 bg-accent-soft text-accent [&_svg]:text-accent")}
                  >
                    <NotebookPen />
                    {n > 0 ? `${n} new ${n === 1 ? "note" : "notes"}` : "Notes"}
                    {n > 0 ? <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-accent" /> : null}
                  </Link>
                  <Link href={`/p/${id}/resources`} className={tile}>
                    <FolderOpen /> Materials
                  </Link>
                  <Link href={`/p/${id}/volunteers`} className={tile}>
                    <HandHeart /> Volunteer
                  </Link>
                </div>
              </div>
            );
          })}
        </nav>
      ) : null}

      {annRows.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[.08em] text-muted">
            <Megaphone className="size-4" /> From the team
          </h2>
          <div className="space-y-2">
            {annRows.map((a) => {
              const isNew = now.getTime() - a.createdAt.getTime() < 48 * 3600_000;
              return (
                <Link
                  key={a.id}
                  href={`/p/${a.productionId}`}
                  className="block rounded-2xl border border-line/80 bg-surface p-4 shadow-card transition-[box-shadow,transform] duration-200 hover:shadow-raised active:scale-[.99]"
                >
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {a.title}
                    {isNew ? <Badge tone="accent">New</Badge> : a.pinned ? <Badge>Pinned</Badge> : null}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-muted">{a.body}</p>
                  {castProdIds.length > 1 ? <p className="mt-1 text-xs text-muted">{prodById.get(a.productionId)?.title}</p> : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {days.size > 0 ? (
        <div className="mt-8 space-y-6">
          <h2 className="font-display text-xl font-semibold">Coming up</h2>
          {[...days.entries()].map(([k, d]) => (
            <section key={k}>
              <h3 className="mb-2 text-sm font-semibold text-muted">{d.label}</h3>
              <div className="space-y-2">
                {d.groups.map((g) => (
                  <CallCard key={g.key} group={g} multi={multi} showProduction={multiProduction} now={now} changed={changedAt(g.key)} changes={unacked.get(g.key)?.changes.flatMap((c) => c.lines) ?? []} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {covered.length > 0 ? (
        <Link href="/home/conflicts" className="mt-6 flex min-h-12 items-center gap-2 rounded-xl px-1 text-sm text-muted hover:text-ink">
          <TriangleAlert className="size-4" />
          <span className="flex-1">Can&apos;t make a rehearsal? Tell the team</span>
          <ChevronRight className="size-4" />
        </Link>
      ) : null}

      {covered.length === 0 && running.length === 0 ? (
        <EmptyState
          title="No calls yet"
          body={`We can't find a performer linked to ${user.email}. Ask your director for an invite link — once you're linked to a cast member, their calls appear here.`}
          action={
            <LinkButton href="/productions" variant="secondary">
              See shows
            </LinkButton>
          }
        />
      ) : null}

      {running.length > 0 ? (
        <div className="mt-10">
          <h2 className="font-display text-xl font-semibold">Shows you&apos;re running</h2>
          {covered.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              {running.every((r) => r.relation === "admin") ? "You run the company." : "You're on the creative team."} Schedules and call
              sheets live in each show.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {running.map(({ production: p, title: ctTitle, relation }) => {
              const evs = runningInfo.events.filter((e) => e.productionId === p.id);
              const drafts = runningInfo.drafts.get(p.id) ?? 0;
              const tz = tzOf(p.orgId);
              const firstDraft = runningInfo.firstDraft.get(p.id);
              const draftHref = `/p/${p.id}/schedule${firstDraft ? `#week-${weekKey(firstDraft, tz)}` : ""}`;
              return (
                <Card key={p.id} className="isolate overflow-hidden p-0">
                  <Link
                    href={`/p/${p.id}/schedule`}
                    aria-label={`${p.title} schedule`}
                    className="relative flex items-center gap-3 border-b border-line px-4 py-3.5 transition-colors hover:bg-surface-2/60"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 -z-10"
                      style={{ background: `linear-gradient(100deg, color-mix(in oklab, ${p.accentColor} 14%, transparent), transparent 70%)` }}
                    />
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: p.accentColor, boxShadow: `0 0 0 4px color-mix(in oklab, ${p.accentColor} 20%, transparent)` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg font-semibold leading-snug tracking-tight">{p.title}</span>
                      <span className="block text-sm text-muted">{ctTitle ?? (relation === "admin" ? "Company admin" : "")}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent">
                      Schedule
                      <ChevronRight aria-hidden className="size-4" />
                    </span>
                  </Link>
                  {drafts > 0 ? (
                    <Link
                      href={draftHref}
                      className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-warn-soft/60 px-4 py-2.5 text-sm transition-colors hover:bg-warn-soft"
                    >
                      <Badge tone="warn">
                        {drafts} draft{drafts === 1 ? "" : "s"}
                      </Badge>
                      <span className="order-last basis-full text-ink/80">
                        {firstDraft ? `From ${fmtDay(firstDraft, tz)} · ` : ""}families can&apos;t see these yet
                      </span>
                      <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-accent">
                        Review &amp; publish <ChevronRight aria-hidden className="size-4" />
                      </span>
                    </Link>
                  ) : null}
                  {evs.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted">Nothing scheduled in the next two weeks.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {evs.map((e) => (
                        <li key={e.id}>
                          <Link href={`/p/${p.id}/schedule/${e.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60">
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate font-medium", e.status === "cancelled" && "text-muted line-through")}>
                                {e.title}
                              </span>
                              <span className="tabular block text-sm text-muted">
                                <span className="font-medium text-ink/80">{relDay(e.startsAt, tz)}</span> · {fmtRange(e.startsAt, e.endsAt, tz)}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-wrap justify-end gap-1">
                              {e.youLead ? <Badge tone="accent">You lead</Badge> : null}
                              <StatusBadges event={e} tz={tz} now={now} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Next ~2 weeks of events in the shows the user runs (blocks led by their title flagged) + draft counts. */
async function getRunningInfo(running: Awaited<ReturnType<typeof getUserProductions>>, now: Date) {
  const ids = running.map((r) => r.production.id);
  const horizon = new Date(now.getTime() + 14 * 86400_000);
  const [rows, draftRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(and(inArray(events.productionId, ids), gte(events.endsAt, now)))
      .orderBy(asc(events.startsAt)),
    db
      .select({ productionId: events.productionId, n: count(), first: min(events.startsAt) })
      .from(events)
      .where(and(inArray(events.productionId, ids), eq(events.status, "draft"), gte(events.endsAt, now)))
      .groupBy(events.productionId),
  ]);
  const soonRows = rows.filter((e) => e.startsAt <= horizon);
  const blocks = soonRows.length
    ? await db
        .select({ eventId: eventBlocks.eventId, leader: eventBlocks.leader })
        .from(eventBlocks)
        .where(inArray(eventBlocks.eventId, soonRows.map((e) => e.id)))
    : [];
  const titleByProd = new Map(running.map((r) => [r.production.id, r.title?.toLowerCase() ?? null]));
  const perProd = new Map<string, number>();
  const list = soonRows
    .filter((e) => {
      const n = perProd.get(e.productionId) ?? 0;
      perProd.set(e.productionId, n + 1);
      return n < 5;
    })
    .map((e) => {
      const t = titleByProd.get(e.productionId);
      return { ...e, youLead: !!t && blocks.some((b) => b.eventId === e.id && b.leader?.toLowerCase() === t) };
    });
  return {
    events: list,
    drafts: new Map(draftRows.map((d) => [d.productionId, d.n])),
    firstDraft: new Map(draftRows.map((d) => [d.productionId, d.first ? new Date(d.first) : null])),
  };
}

function FilterChip({ href, active, label, color }: { href: string; active: boolean; label: string; color?: string }) {
  return (
    <Chip href={href} active={active} color={color}>
      {label}
    </Chip>
  );
}

/** Event location plus any block rooms this person is in ("Riverside Hall · Room A"). */
function whereLabel(group: EventGroup) {
  const ev = group.calls[0].event;
  const rooms = [...new Set(group.calls.flatMap((c) => c.blocks.map((b) => b.location).filter((l): l is string => !!l)))];
  return [ev.location, ...rooms.filter((r) => r !== ev.location)].filter(Boolean).join(" · ");
}

function conflictHref(c: PersonCall, tz: string) {
  const q = new URLSearchParams({
    person: c.person.id,
    date: toDateInput(c.callAt, tz),
    start: toTimeInput(c.callAt, tz),
    end: toTimeInput(c.releaseAt, tz),
  });
  return `/home/conflicts?${q}`;
}

function startsIn(d: Date, now: Date) {
  const mins = Math.round((d.getTime() - now.getTime()) / 60000);
  if (mins <= 0 || mins > 180) return null;
  if (mins < 60) return `Starts in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Starts in ${h} hr${m ? ` ${m} min` : ""}`;
}

function HeroCard({
  group,
  label,
  multi,
  now,
  cancelledSameDay,
  changed,
  changes,
}: {
  group: EventGroup;
  label: string;
  multi: boolean;
  now: Date;
  cancelledSameDay: EventGroup[];
  changed: Date | null;
  changes: string[];
}) {
  const { tz } = group;
  const first = group.calls[0];
  const ev = first.event;
  const accent = first.production.accentColor;
  const loc = whereLabel(group);
  const href = `/p/${first.production.id}/schedule/${ev.id}`;
  const soon = startsIn(first.callAt, now);
  const pickups = group.calls.length > 1 ? group.calls.map((c) => `${c.person.firstName} ${fmtTime(c.releaseAt, tz)}`).join(" · ") : null;
  return (
    <Ticket
      accent={accent}
      stub={
        <div className="-mx-5 -mb-4 -mt-3.5">
          {loc ? (
            <a
              href={mapsUrl(ev.location ?? loc)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 items-center gap-2 px-5 text-[15px] transition-colors hover:bg-surface-2/60"
            >
              <MapPin className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">{loc}</span>
              <ExternalLink className="size-4 shrink-0 text-muted" aria-label="Open in Maps" />
            </a>
          ) : null}
          <div className="flex gap-2 px-4 pb-4 pt-1">
            <LinkButton href={href} variant="soft" className="flex-1">
              Details
            </LinkButton>
            <LinkButton href={conflictHref(first, tz)} variant="ghost" className="flex-1 text-muted">
              Can&apos;t make it
            </LinkButton>
          </div>
        </div>
      }
    >
      <Link href={href} className="-m-5 block rounded-t-3xl p-5 transition-colors hover:bg-surface-2/40">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 pt-0.5 text-xs font-semibold uppercase tracking-[.08em] text-gold">
            <CalendarClock className="size-4" /> Next call · {label}
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            <StatusBadges event={ev} tz={tz} now={now} changed={changed} />
          </span>
        </div>
        {soon ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
            {soon}
          </p>
        ) : null}
        {cancelledSameDay.map((g) => (
          <p key={g.key} className="mt-3 flex items-start gap-1.5 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            <Ban className="mt-0.5 size-4 shrink-0" />
            <span>
              {g.calls.map((c) => c.person.firstName).join(" & ")}&apos;s {fmtTime(g.calls[0].callAt, g.tz)} {g.calls[0].event.title} that day is{" "}
              <strong>cancelled</strong>.
            </span>
          </p>
        ))}
        <div className="mt-4 space-y-4">
          {group.calls.map((c) => (
            <div key={c.person.id}>
              {multi || group.calls.length > 1 ? <PersonChip name={c.person.firstName} className="mb-1.5" /> : null}
              <CallTime size={group.calls.length > 1 ? "lg" : "xl"}>{fmtRange(c.callAt, c.releaseAt, tz)}</CallTime>
              <p className="mt-1 text-base">{c.reasons.join(", ")}</p>
            </div>
          ))}
        </div>
        {pickups ? (
          <p className="tabular mt-3 text-[15px] text-muted">
            <span className="font-semibold text-ink">Pick up:</span> {pickups}
          </p>
        ) : null}
        <p className="mt-3 text-[15px] text-muted">
          {first.production.title} · {ev.title}
        </p>
        {changed ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm">
            <RefreshCw className="mt-0.5 size-4 shrink-0 text-gold" />
            <span>
              <strong>Changed {fmtDay(changed, tz)}:</strong> {changes.join("; ")}
            </span>
          </p>
        ) : null}
        {ev.notes ? (
          <p className="mt-3 flex items-start gap-2 text-[15px]">
            <StickyNote className="mt-0.5 size-4 shrink-0 text-muted" />
            <span className="line-clamp-2">{ev.notes}</span>
          </p>
        ) : null}
      </Link>
    </Ticket>
  );
}

function CallCard({
  group,
  multi,
  showProduction,
  now,
  changed,
  changes,
}: {
  group: EventGroup;
  multi: boolean;
  showProduction: boolean;
  now: Date;
  changed: Date | null;
  changes: string[];
}) {
  const { tz } = group;
  const first = group.calls[0];
  const ev = first.event;
  const cancelled = ev.status === "cancelled";
  const where = whereLabel(group);
  return (
    <Link
      href={`/p/${first.production.id}/schedule/${ev.id}`}
      className={cn(
        "flex gap-3 rounded-2xl border bg-surface p-4 shadow-card transition-[box-shadow,transform] duration-200 hover:shadow-raised active:scale-[.99]",
        cancelled ? "border-danger/30" : changed ? "border-gold-bright/60" : "border-line/80",
      )}
    >
      <KindIcon kind={ev.kind} color={cancelled ? undefined : first.production.accentColor} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("min-w-0 font-medium", cancelled && "text-muted line-through")}>
            {ev.title}
            {showProduction ? (
              <span className="font-normal" style={{ color: cancelled ? undefined : first.production.accentColor }}>
                {" "}
                · {first.production.title}
              </span>
            ) : null}
          </p>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            <StatusBadges event={ev} tz={tz} now={now} changed={changed} />
          </span>
        </div>
        <div className="mt-1 space-y-1.5">
          {group.calls.map((c) => (
            <div key={c.person.id}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {multi ? <PersonChip name={c.person.firstName} /> : null}
                <span className={cn("tabular text-[17px] font-semibold", cancelled && "text-muted line-through decoration-danger decoration-2")}>
                  {fmtRange(c.callAt, c.releaseAt, tz)}
                </span>
              </div>
              <p className={cn("text-sm", cancelled && "text-muted")}>{c.reasons.join(", ")}</p>
            </div>
          ))}
        </div>
        {changes.length ? <p className="mt-1 text-sm text-muted">{changes.at(-1)}</p> : cancelled && ev.changeNote ? <p className="mt-1 text-sm text-muted">{ev.changeNote}</p> : null}
        {where ? (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <MapPin className="size-3.5 shrink-0" /> <span className="truncate">{where}</span>
          </p>
        ) : null}
        {ev.notes && !cancelled ? (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <StickyNote className="size-3.5 shrink-0" /> <span className="truncate">{ev.notes}</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}
