import { inArray } from "drizzle-orm";
import { ClipboardCheck, Clock, Eye, RefreshCw, Ellipsis, ExternalLink, Mail, MapPin, Pencil, Phone, RotateCcw, Send, StickyNote, Trash, TriangleAlert, Undo2, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { people } from "@/db/schema";
import { Avatar, BackLink, Badge, CallTime, Card, cn, LinkButton, Menu, Notice, SectionTitle, TimePill } from "@/components/ui";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { getEventCallSheet } from "@/lib/calls";
import { getAckStatus, getUnacknowledgedChanges } from "@/lib/changes";
import { getConflictsFor, getGuardianContacts } from "@/lib/schedule";
import { KIND_META, mapsUrl, overlaps, personName, recentChange } from "@/lib/schedule-shared";
import { dayKey, fmtDay, fmtDayLong, fmtRange, fmtTime, toDateInput, toTimeInput } from "@/lib/time";
import { deleteEvent, setEventStatus } from "../actions";
import { ActionButton } from "../_components/action-button";
import { CancelEventButton } from "../_components/cancel-button";
import { KindIcon, PersonChip, StatusBadges } from "../_components/bits";
import { DuplicateButton } from "../_components/duplicate-button";
import { PrintButton } from "../_components/print-button";
import { GotItButton } from "../../../../home/_components/got-it";

const PRINT_CSS = `
@media print {
  nav, .no-print, div:has(> ul > li > a[href$="/schedule"]) { display: none !important; }
  .md\\:pl-60 { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  body { background: #fff !important; color: #000 !important; }
  .print-break { break-inside: avoid; }
}`;

const coveredInCastCalled = (calls: Map<string, unknown>, covered: Set<string>) => [...covered].some((id) => calls.has(id));

export default async function EventPage({ params }: PageProps<"/p/[productionId]/schedule/[eventId]">) {
  const { productionId, eventId } = await params;
  const { user, org, canEdit, production } = await requireProductionAccess(productionId);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const sheet = await getEventCallSheet(eventId);
  if (!sheet || sheet.event.productionId !== productionId) notFound();
  const ev = sheet.event;
  if (!canEdit && ev.status === "draft") notFound();

  const tz = org.timezone;
  const now = new Date();
  const changed = recentChange(ev, now);
  const isEventDay = dayKey(ev.startsAt, tz) === dayKey(now, tz);
  const base = `/p/${productionId}/schedule`;
  const cancelled = ev.status === "cancelled";
  const calledIds = [...sheet.calls.keys()];

  const covered = new Set(await getCoveredPersonIds(user.id));
  const coveredInCast = [...covered].filter((id) => sheet.idx.allCast.has(id));
  const coveredPeople = coveredInCast.length ? await db.select().from(people).where(inArray(people.id, coveredInCast)) : [];
  coveredPeople.sort((a, b) => a.firstName.localeCompare(b.firstName));
  const [unackedAll, ackStatus] = await Promise.all([
    !canEdit || coveredInCastCalled(sheet.calls, covered) ? getUnacknowledgedChanges(user.id) : Promise.resolve([]),
    canEdit ? getAckStatus(eventId) : Promise.resolve(null),
  ]);
  const myUnacked = unackedAll.find((u) => u.event.id === ev.id) ?? null;

  // Editors: conflicts that overlap the blocks each person is called to, plus guardian contacts.
  const conflictRows = canEdit ? await getConflictsFor(calledIds, productionId, ev.startsAt, ev.endsAt) : [];
  const blockById = new Map(sheet.blocks.map((b) => [b.id, b]));
  const conflictsByPerson = new Map<string, typeof conflictRows>();
  for (const c of conflictRows) {
    const call = sheet.calls.get(c.personId);
    if (!call) continue;
    const hit = call.blockIds.some((bid) => {
      const b = blockById.get(bid);
      return b && overlaps(b.startsAt, b.endsAt, c.startsAt, c.endsAt);
    });
    if (hit) conflictsByPerson.set(c.personId, [...(conflictsByPerson.get(c.personId) ?? []), c]);
  }
  const minors = calledIds.filter((id) => sheet.people.get(id)?.isMinor);
  const guardians = await getGuardianContacts(canEdit ? minors : []);

  // Call sheet: everyone grouped by the block where their call starts, sorted by call time.
  const groups = new Map<string, { blockId: string; people: string[] }>();
  const sortedCalls = [...sheet.calls.values()].sort(
    (a, b) =>
      a.callAt.getTime() - b.callAt.getTime() ||
      (sheet.people.get(a.personId)?.firstName ?? "").localeCompare(sheet.people.get(b.personId)?.firstName ?? ""),
  );
  for (const c of sortedCalls) {
    const first = c.blockIds.find((bid) => blockById.get(bid)?.startsAt.getTime() === c.callAt.getTime()) ?? c.blockIds[0];
    const g = groups.get(first) ?? { blockId: first, people: [] };
    g.people.push(c.personId);
    groups.set(first, g);
  }

  // Labels with names for individually-called people (the engine's generic label is "Individual")
  const callLabels = (b: (typeof sheet.blocks)[number]) =>
    b.calls.map((c, i) => {
      if (c.target !== "person") return b.labels[i];
      const p = sheet.people.get(c.targetId ?? "");
      return p ? (canEdit ? personName(p) : p.firstName) : b.labels[i];
    });
  const blockLabel = (b: (typeof sheet.blocks)[number]) => b.title || callLabels(b).join(", ") || "Rehearsal";
  const mapsHref = ev.location ? mapsUrl(ev.location) : null;
  const what = `${fmtDay(ev.startsAt, tz)} ${ev.title}`;

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <BackLink href={base} label="Schedule" className="no-print mb-2" />

      <div className="flex items-start gap-3">
        <KindIcon kind={ev.kind} color={cancelled ? undefined : production.accentColor} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn("font-display text-2xl font-semibold leading-tight", cancelled && "text-muted line-through")}>{ev.title}</h2>
            <StatusBadges event={ev} tz={tz} now={now} showPublished={canEdit} verb={canEdit ? "Updated" : "Changed"} />
          </div>
          <p className="text-sm text-muted">{KIND_META[ev.kind].label}</p>
        </div>
      </div>

      <div className={cn("mt-4 space-y-1.5", cancelled && "text-muted")}>
        <p className="flex items-center gap-2 font-medium">
          <Clock className="size-4 shrink-0 text-muted" />
          <span className={cn(cancelled && "line-through")}>
            {fmtDayLong(ev.startsAt, tz)} · {fmtRange(ev.startsAt, ev.endsAt, tz)}
          </span>
        </p>
        {ev.location ? (
          <a
            href={mapsHref!}
            target="_blank"
            rel="noreferrer"
            className="-mx-2 flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-surface-2"
          >
            <MapPin className="size-4 shrink-0 text-muted" />
            <span className="underline decoration-line underline-offset-4">{ev.location}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted" aria-label="Open in Maps" />
          </a>
        ) : null}
      </div>

      {canEdit && ev.status === "draft" ? (
        <div className="mt-4">
          <Notice tone="warn">Draft — only the creative team can see this. Publish it to show families their calls.</Notice>
        </div>
      ) : null}
      {cancelled ? (
        <div className="mt-4">
          <Notice tone="danger">
            <span className="font-semibold">This event is cancelled.</span>
            {ev.changeNote ? ` ${ev.changeNote}` : ""}
          </Notice>
        </div>
      ) : canEdit && changed ? (
        <div className="mt-4">
          <Notice tone="warn">
            <span className="font-semibold">Changed {fmtDay(changed, tz)}.</span> {ev.changeNote ?? "Check the times below."}
          </Notice>
        </div>
      ) : null}
      {myUnacked ? (
        <div className="mt-4 rounded-2xl border border-warn/40 bg-warn-soft p-4">
          <p className="flex items-center gap-1.5 font-semibold text-warn">
            <RefreshCw className="size-4" /> What changed
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {myUnacked.changes.map((c) => (
              <li key={c.revision}>
                {c.lines.join("; ")} <span className="text-muted">· {fmtDay(c.createdAt, tz)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <GotItButton eventId={ev.id} revision={myUnacked.latestRevision} />
          </div>
        </div>
      ) : null}
      {canEdit && ackStatus?.latestChange ? (
        <details className="no-print mt-4 rounded-2xl border border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm">
            <Eye className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <strong>
                {ackStatus.seenCount} of {ackStatus.total}
              </strong>{" "}
              affected {ackStatus.total === 1 ? "family has" : "families have"} seen the change:{" "}
              <span className="text-muted">{ackStatus.latestChange.summary}</span>
            </span>
          </summary>
          <div className="border-t border-line px-4 py-3 text-sm">
            {ackStatus.people.filter((r) => !r.seen).length === 0 ? (
              <p className="text-success">Everyone has seen it.</p>
            ) : (
              <>
                <p className="mb-1 font-medium">Not seen yet</p>
                <ul className="space-y-1">
                  {ackStatus.people
                    .filter((r) => !r.seen)
                    .map((r) => (
                      <li key={r.personId}>
                        {r.name}
                        <span className="text-muted">
                          {" "}
                          · {r.reachable ? r.accounts.map((a) => a.name).join(", ") : "no account linked — call or text"}
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        </details>
      ) : null}
      {ev.notes ? (
        <div className="mt-4">
          <Notice>
            <span className="inline-flex items-start gap-2">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-muted" />
              <span>{ev.notes}</span>
            </span>
          </Notice>
        </div>
      ) : null}

      {canEdit ? (
        <div className="no-print mt-5 flex flex-wrap items-start gap-2">
          {ev.status !== "draft" && isEventDay ? (
            <LinkButton href={`${base}/${ev.id}/attendance`}>
              <ClipboardCheck className="size-4" /> Take attendance
            </LinkButton>
          ) : null}
          <LinkButton href={`${base}/${ev.id}/edit`} variant={isEventDay && ev.status !== "draft" ? "secondary" : "primary"}>
            <Pencil className="size-4" /> Edit
          </LinkButton>
          {ev.status !== "draft" && !isEventDay && ev.startsAt < now ? (
            <LinkButton href={`${base}/${ev.id}/attendance`} variant="ghost">
              <ClipboardCheck className="size-4" /> Attendance
            </LinkButton>
          ) : null}
          {ev.status === "draft" ? (
            <ActionButton
              action={setEventStatus.bind(null, productionId, ev.id, "publish", undefined)}
              confirm={`Publish ${what}? ${sheet.calls.size} people will see their calls, and calendar feeds update automatically.`}
              pendingLabel="Publishing…"
              variant="secondary"
            >
              <Send className="size-4" /> Publish
            </ActionButton>
          ) : null}
          {ev.status === "published" ? <CancelEventButton productionId={productionId} eventId={ev.id} people={sheet.calls.size} what={what} /> : null}
          {cancelled ? (
            <ActionButton
              action={setEventStatus.bind(null, productionId, ev.id, "restore", undefined)}
              confirm="Restore this event? Families will see it back on their schedule, marked Updated."
              variant="secondary"
            >
              <RotateCcw className="size-4" /> Restore
            </ActionButton>
          ) : null}
          <DuplicateButton productionId={productionId} eventId={ev.id} defaultDate={toDateInput(new Date(ev.startsAt.getTime() + 7 * 86400_000), tz)} />
          <PrintButton />
          {ev.status === "draft" ? (
            <ActionButton
              action={deleteEvent.bind(null, productionId, ev.id)}
              confirm="Delete this draft? This can't be undone."
              then={base}
              variant="ghost"
              className="text-danger"
            >
              <Trash className="size-4" /> Delete draft
            </ActionButton>
          ) : ev.status === "published" ? (
            <Menu
              id="event-more"
              label="More"
              trigger={
                <>
                  <Ellipsis className="size-4" /> More
                </>
              }
            >
              <div className="max-w-xs space-y-2 p-2">
                <p className="text-xs text-muted">
                  Unpublishing makes the event disappear from families&apos; schedules without a trace. Usually you want <strong>Cancel</strong>{" "}
                  instead, so they see it&apos;s off. Published events can&apos;t be deleted.
                </p>
                <ActionButton
                  action={setEventStatus.bind(null, productionId, ev.id, "unpublish", undefined)}
                  confirm="Move back to draft? It disappears from families' schedules and calendars (they won't see a cancellation)."
                  variant="secondary"
                  className="w-full"
                >
                  <Undo2 className="size-4" /> Unpublish to draft
                </ActionButton>
              </div>
            </Menu>
          ) : null}
        </div>
      ) : null}

      {/* Cast / guardian: your calls */}
      {coveredPeople.length > 0 ? (
        <div className="mt-6 space-y-2">
          {coveredPeople.map((p) => {
            const c = sheet.calls.get(p.id);
            return (
              <Card key={p.id} className={cn("flex flex-col items-start gap-3 sm:flex-row sm:items-center", c && !cancelled && "border-accent/40 bg-accent-soft/40")}>
                <div className="flex min-w-0 items-center gap-3 self-stretch">
                  <Avatar name={p.firstName} />
                  <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.firstName}</p>
                  {c ? (
                    <p className="text-sm text-muted">{c.reasons.join(", ")}</p>
                  ) : (
                    <p className="text-sm text-muted">Not called for this event</p>
                  )}
                  </div>
                </div>
                {c ? (
                  <div className="sm:ml-auto sm:text-right">
                    <CallTime size="md" strike={cancelled}>
                      {fmtRange(c.callAt, c.releaseAt, tz)}
                    </CallTime>
                    {!cancelled && c.releaseAt > now ? (
                      <Link
                        href={`/home/conflicts?${new URLSearchParams({ person: p.id, date: toDateInput(c.callAt, tz), start: toTimeInput(c.callAt, tz), end: toTimeInput(c.releaseAt, tz) })}`}
                        className="no-print -my-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
                      >
                        Can&apos;t make it?
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}

      {canEdit && conflictsByPerson.size > 0 ? (
        <div className="mt-5">
          <Notice tone="warn">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="size-4" /> {conflictsByPerson.size} {conflictsByPerson.size === 1 ? "person has" : "people have"} a conflict
            </span>
            <ul className="mt-1 space-y-0.5">
              {[...conflictsByPerson.entries()].map(([pid, cs]) => (
                <li key={pid}>
                  {personName(sheet.people.get(pid) ?? { firstName: "Someone", lastName: "" })}:{" "}
                  {cs.map((c) => `${fmtRange(c.startsAt, c.endsAt, tz)}${c.note ? ` (${c.note})` : ""}`).join("; ")}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      {/* Run of show */}
      <SectionTitle>{canEdit || coveredPeople.length === 0 ? "Schedule" : "Rehearsal plan"}</SectionTitle>
      {sheet.blocks.length === 0 ? (
        <p className="text-sm text-muted">No blocks yet{canEdit ? " — edit the event to call scenes or people." : "."}</p>
      ) : (
        <ol className="relative space-y-2">
          {sheet.blocks.map((b) => {
            const mine = coveredPeople.filter((p) => b.personIds.has(p.id));
            const dim = !canEdit && coveredPeople.length > 0 && mine.length === 0;
            return (
              <li
                key={b.id}
                className={cn("print-break rounded-2xl border bg-surface p-4 shadow-card", mine.length ? "border-accent/50" : "border-line/80", dim && "opacity-60")}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <TimePill tone={mine.length ? "accent" : "neutral"}>{fmtRange(b.startsAt, b.endsAt, tz)}</TimePill>
                  <span className="min-w-0 flex-1 font-semibold">{blockLabel(b)}</span>
                </div>
                {b.title && b.labels.length ? <p className="mt-0.5 text-sm text-muted">{callLabels(b).join(", ")}</p> : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {b.leader ? <span>with {b.leader}</span> : null}
                  {b.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" /> {b.location}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" /> {b.personIds.size}
                    </span>
                  ) : null}
                </div>
                {b.notes ? <p className="mt-1 text-sm">{b.notes}</p> : null}
                {mine.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {mine.map((p) => (
                      <PersonChip key={p.id} name={p.firstName} />
                    ))}
                  </div>
                ) : dim ? (
                  <p className="mt-1 text-xs text-muted">Not called for this part</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* Full call sheet (creative team) */}
      {canEdit ? (
        <>
          <SectionTitle action={<span className="text-xs text-muted">{sheet.calls.size} called</span>}>Call sheet</SectionTitle>
          {sheet.calls.size === 0 ? (
            <p className="text-sm text-muted">No one is called yet.</p>
          ) : (
            <div className="space-y-4">
              {[...groups.values()].map((g) => {
                const b = blockById.get(g.blockId)!;
                return (
                  <div key={g.blockId} className="print-break overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-card">
                    <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-sm">
                      <TimePill tone="solid" size="sm">
                        Called {fmtTime(b.startsAt, tz)}
                      </TimePill>
                      <span className="truncate font-medium text-muted">{blockLabel(b)}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {g.people.map((pid) => {
                        const p = sheet.people.get(pid);
                        const c = sheet.calls.get(pid)!;
                        const cs = conflictsByPerson.get(pid);
                        const gs = guardians.get(pid) ?? [];
                        return (
                          <li key={pid} className="flex gap-3 px-4 py-2.5">
                            <Avatar name={p ? personName(p) : "?"} className="mt-0.5 size-8 print:hidden" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2">
                                <span className="font-medium">{p ? personName(p) : "Unknown"}</span>
                                {p?.isMinor ? <Badge>Minor</Badge> : null}
                                {cs ? (
                                  <Badge tone="warn">
                                    <TriangleAlert className="size-3" /> Conflict
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted">{c.reasons.join(", ")}</p>
                              {p?.isMinor ? (
                                gs.length ? (
                                  gs.map((gd) => (
                                    <p key={gd.name} className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                                      <span className="text-muted">{gd.relationship}:</span>
                                      <span>{gd.name}</span>
                                      {gd.phone ? (
                                        <a href={`tel:${gd.phone}`} className="-my-1 inline-flex min-h-11 items-center gap-1 rounded-full px-1.5 text-sm text-accent">
                                          <Phone className="size-3.5" /> {gd.phone}
                                        </a>
                                      ) : null}
                                      {gd.email ? (
                                        <a href={`mailto:${gd.email}`} className="-my-1 inline-flex min-h-11 items-center gap-1 rounded-full px-1.5 text-sm text-accent">
                                          <Mail className="size-3.5" /> {gd.email}
                                        </a>
                                      ) : null}
                                    </p>
                                  ))
                                ) : (
                                  <p className="mt-0.5 text-xs text-warn">No guardian on file</p>
                                )
                              ) : p?.phone || p?.email ? (
                                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                                  {p.phone ? (
                                    <a href={`tel:${p.phone}`} className="-my-1 inline-flex min-h-11 items-center gap-1 rounded-full px-1.5 text-sm text-accent">
                                      <Phone className="size-3.5" /> {p.phone}
                                    </a>
                                  ) : null}
                                  {p.email ? (
                                    <a href={`mailto:${p.email}`} className="-my-1 inline-flex min-h-11 items-center gap-1 rounded-full px-1.5 text-sm text-accent">
                                      <Mail className="size-3.5" /> {p.email}
                                    </a>
                                  ) : null}
                                </p>
                              ) : null}
                            </div>
                            <TimePill size="sm" className="mt-0.5 shrink-0 self-start">{fmtRange(c.callAt, c.releaseAt, tz)}</TimePill>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
