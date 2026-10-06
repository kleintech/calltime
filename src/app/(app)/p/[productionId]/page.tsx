import { addLocalDays } from "@/lib/schedule-shared";
import { and, asc, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { AlertTriangle, Ban, Check, ChevronRight, Circle, FileSpreadsheet, Link2 } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { announcements, events, guardianships, people, resources, roleAssignments, roles, sceneRoles, scenes, users } from "@/db/schema";
import { Badge, Card, EmptyState, LinkButton, SectionTitle, cn } from "@/components/ui";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { getCallsForPeople, sceneLabel } from "@/lib/calls";
import { daysSince, getMaterialsForPeople, getRehearsalStats } from "@/lib/production-queries";
import { ResourceList } from "./resources/resource-list";
import { dayKey, fmtDay, fmtRange } from "@/lib/time";
import { AnnouncementForm } from "./_overview/announcement-form";
import { AnnouncementList } from "./_overview/announcements";
import { postAnnouncement } from "./_overview/actions";

export default async function ProductionOverview({ params }: PageProps<"/p/[productionId]">) {
  const { productionId } = await params;
  const { user, canEdit, org, production } = await requireProductionAccess(productionId);
  const tz = org.timezone;
  const base = `/p/${productionId}`;
  const now = new Date();

  const annRows = await db
    .select({ a: announcements, authorName: users.name })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.authorUserId))
    .where(eq(announcements.productionId, productionId))
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
    .limit(20);
  const anns = annRows.map((r) => ({ ...r.a, authorName: r.authorName }));

  if (!canEdit) {
    const covered = await getCoveredPersonIds(user.id);
    const materials = await getMaterialsForPeople(productionId, covered);
    const materialPeople = materials.byPerson.size
      ? await db.select().from(people).where(inArray(people.id, [...materials.byPerson.keys()]))
      : [];
    const calls = (await getCallsForPeople(covered, { from: now })).filter((c) => c.production.id === productionId).slice(0, 6);
    const today = dayKey(now, tz);
    const tomorrow = dayKey(addLocalDays(now, 1, tz), tz);
    const dayLabel = (d: Date) => {
      const k = dayKey(d, tz);
      return k === today ? `Today · ${fmtDay(d, tz)}` : k === tomorrow ? `Tomorrow · ${fmtDay(d, tz)}` : fmtDay(d, tz);
    };
    return (
      <div>
        <SectionTitle action={<Link href={`${base}/schedule`} className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-accent">Full schedule →</Link>}>
          Upcoming calls
        </SectionTitle>
        {calls.length ? (
          <div className="space-y-2">
            {calls.map((c) => (
              <Link
                key={`${c.event.id}:${c.person.id}`}
                href={`${base}/schedule/${c.event.id}`}
                className={cn("block rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2", c.event.status === "cancelled" && "opacity-70")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(c.callAt)}</p>
                    <p className={cn("font-display text-xl font-semibold", c.event.status === "cancelled" && "line-through")}>
                      Called {fmtRange(c.callAt, c.releaseAt, tz)}
                    </p>
                    <p className="text-base">{c.event.title}</p>
                    {c.event.location ? <p className="text-sm text-muted">{c.event.location}</p> : null}
                    <p className="text-sm text-muted">{c.reasons.join(" · ")}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone="accent">{c.person.userId === user.id ? "You" : c.person.firstName}</Badge>
                    {c.event.status === "cancelled" ? (
                      <Badge tone="danger">
                        <Ban className="size-3" /> Cancelled
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No upcoming calls" body="When the director publishes the rehearsal schedule, your calls show up here and in your calendar." />
        )}
        <SectionTitle>Announcements</SectionTitle>
        <AnnouncementList rows={anns} tz={tz} canEdit={false} productionId={productionId} />
        {materialPeople.length || materials.general.length ? (
          <>
            <SectionTitle
              action={
                <Link href={`${base}/resources`} className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-accent">
                  All materials →
                </Link>
              }
            >
              Rehearsal materials
            </SectionTitle>
            <div className="space-y-3">
              {materialPeople.map((p) => (
                <div key={p.id}>
                  <p className="mb-1.5 text-sm font-semibold">
                    {p.userId === user.id ? "Your" : `${p.firstName}'s`} tracks & scripts
                  </p>
                  <ResourceList items={(materials.byPerson.get(p.id) ?? []).slice(0, 5)} productionId={productionId} />
                </div>
              ))}
              {materials.general.length ? (
                <div>
                  <p className="mb-1.5 text-sm font-semibold">For everyone</p>
                  <ResourceList items={materials.general.slice(0, 3)} productionId={productionId} />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {production.defaultLocation || production.venue ? (
          <>
            <SectionTitle>Where</SectionTitle>
            <Card className="space-y-1 text-sm">
              {production.defaultLocation ? <p><span className="text-muted">Rehearsals:</span> {production.defaultLocation}</p> : null}
              {production.venue ? <p><span className="text-muted">Performances:</span> {production.venue}</p> : null}
            </Card>
          </>
        ) : null}
      </div>
    );
  }

  /* ─────────── Editor overview ─────────── */
  const roleIdRows = await db.select({ id: roles.id }).from(roles).where(eq(roles.productionId, productionId));
  const roleIds = roleIdRows.map((r) => r.id);
  const [[sceneCount], assigns, breakdownLinks, [upcomingCount], upcoming] = await Promise.all([
    db.select({ n: count() }).from(scenes).where(eq(scenes.productionId, productionId)),
    roleIds.length
      ? db
          .select({ roleId: roleAssignments.roleId, personId: roleAssignments.personId, userId: people.userId })
          .from(roleAssignments)
          .innerJoin(people, eq(people.id, roleAssignments.personId))
          .where(inArray(roleAssignments.roleId, roleIds))
      : Promise.resolve([]),
    roleIds.length
      ? db.selectDistinct({ sceneId: sceneRoles.sceneId }).from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds))
      : Promise.resolve([]),
    db.select({ n: count() }).from(events).where(and(eq(events.productionId, productionId), gte(events.endsAt, now))),
    db
      .select()
      .from(events)
      .where(and(eq(events.productionId, productionId), gte(events.endsAt, now)))
      .orderBy(asc(events.startsAt))
      .limit(3),
  ]);
  const castCount = new Set(assigns.map((a) => a.personId)).size;
  const castRoleIds = new Set(assigns.map((a) => a.roleId));
  const unassigned = roleIds.filter((id) => !castRoleIds.has(id)).length;
  const [eventTotal] = await db.select({ n: count() }).from(events).where(eq(events.productionId, productionId));
  const emptyScenes = sceneCount.n - breakdownLinks.length;

  // A cast member's family has "joined" when the performer or any of their guardians has an account.
  const castIds = [...new Set(assigns.map((a) => a.personId))];
  const joined = new Set(assigns.filter((a) => a.userId).map((a) => a.personId));
  if (castIds.length) {
    const g = await db
      .select({ minorId: guardianships.minorId })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.guardianId))
      .where(and(inArray(guardianships.minorId, castIds), isNotNull(people.userId)));
    for (const r of g) joined.add(r.minorId);
  }

  const stats = [
    { label: "Scenes", value: sceneCount.n, href: `${base}/scenes` },
    { label: "Roles", value: roleIds.length, href: `${base}/roles` },
    { label: "Cast", value: castCount, href: `${base}/cast` },
    { label: "Not cast", value: unassigned, href: `${base}/cast`, warn: unassigned > 0 },
    { label: "Upcoming", value: upcomingCount.n, href: `${base}/schedule` },
  ];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // Scenes nobody has worked lately (scene calls only), unless they're already on the next week's plan.
  const [rehearsal, sceneList, [resourceCount]] = await Promise.all([
    getRehearsalStats(productionId, now),
    db.select().from(scenes).where(eq(scenes.productionId, productionId)).orderBy(asc(scenes.act), asc(scenes.sortOrder)),
    db.select({ n: count() }).from(resources).where(eq(resources.productionId, productionId)),
  ]);
  const weekAhead = new Date(now.getTime() + 7 * 86400_000);
  const neglected = rehearsal.started
    ? sceneList
        .map((sc) => ({ sc, st: rehearsal.scenes.get(sc.id)! }))
        .filter(({ st }) => st && (!st.last || daysSince(st.last, now) > 10) && !(st.next && st.next.at <= weekAhead))
        .sort((a, b) => (a.st.last?.getTime() ?? 0) - (b.st.last?.getTime() ?? 0))
    : [];
  const steps = [
    { label: "Add roles", detail: roleIds.length ? plural(roleIds.length, "role") : null, done: roleIds.length > 0, href: `${base}/roles` },
    { label: "Add scenes", detail: sceneCount.n ? plural(sceneCount.n, "scene") : null, done: sceneCount.n > 0, href: `${base}/scenes` },
    {
      label: "Who's in each scene",
      detail: sceneCount.n ? (emptyScenes > 0 ? `${plural(emptyScenes, "scene")} with nobody in it` : "Every scene has roles") : null,
      done: sceneCount.n > 0 && emptyScenes === 0,
      href: `${base}/breakdown`,
    },
    {
      label: "Cast the roles",
      detail: roleIds.length ? (unassigned > 0 ? `${plural(unassigned, "role")} not cast` : "Every role is cast") : null,
      done: roleIds.length > 0 && unassigned === 0,
      href: `${base}/cast`,
    },
    {
      label: "Invite families",
      detail: castIds.length ? `${joined.size} of ${castIds.length} joined` : null,
      done: castIds.length > 0 && joined.size === castIds.length,
      href: `${base}/cast`,
    },
    { label: "Build the schedule", detail: eventTotal.n ? plural(eventTotal.n, "event") : null, done: eventTotal.n > 0, href: `${base}/schedule` },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-2xl border border-line bg-surface px-3 py-3 hover:bg-surface-2">
            <p className={cn("font-display text-2xl font-semibold tabular-nums", s.warn && "text-warn")}>{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </Link>
        ))}
      </div>

      {!setupDone ? (
        <>
          <SectionTitle>Get set up</SectionTitle>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {steps.map((s, i) => (
              <Link key={s.label} href={s.href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                {s.done ? (
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-success-soft text-success">
                    <Check className="size-4" />
                  </span>
                ) : (
                  <span className="relative inline-flex size-7 items-center justify-center text-muted">
                    <Circle className="size-7" strokeWidth={1.5} />
                    <span className="absolute text-xs font-semibold">{i + 1}</span>
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", s.done && "text-muted")}>{s.label}</span>
                  {s.detail ? <span className={cn("block text-sm", s.done ? "text-muted" : "text-warn")}>{s.detail}</span> : null}
                </span>
                <ChevronRight className="size-4 text-muted" />
              </Link>
            ))}
          </div>
          <Link
            href={`${base}/import`}
            className="mt-2 flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-medium text-accent"
          >
            <FileSpreadsheet className="size-4" aria-hidden /> Have a spreadsheet? Import roles, scenes and cast →
          </Link>
        </>
      ) : null}

      {neglected.length ? (
        <>
          <SectionTitle
            action={
              <Link href={`${base}/scenes`} className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-accent">
                All scenes →
              </Link>
            }
          >
            Needs attention
          </SectionTitle>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-warn/40 bg-surface">
            {neglected.slice(0, 4).map(({ sc, st }) => (
              <Link key={sc.id} href={`${base}/scenes/${sc.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{sceneLabel(sc)}</span>
                  <span className="block text-sm text-warn">
                    {st.last ? `Not rehearsed in ${daysSince(st.last, now)} days` : "Never rehearsed"}
                    {st.next ? <span className="text-muted"> · next {fmtDay(st.next.at, tz)}</span> : <span className="text-muted"> · not scheduled</span>}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
            {neglected.length > 4 ? (
              <Link href={`${base}/scenes`} className="flex min-h-11 items-center px-4 text-sm text-muted hover:bg-surface-2">
                + {neglected.length - 4} more scenes
              </Link>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-muted">Scenes not called in 10+ days and not on the next 7 days&apos; schedule. Full-cast runs don&apos;t count.</p>
        </>
      ) : null}

      <SectionTitle action={<Link href={`${base}/schedule`} className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-accent">Schedule →</Link>}>
        Coming up
      </SectionTitle>
      {upcoming.length ? (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {upcoming.map((e) => (
            <Link key={e.id} href={`${base}/schedule/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="w-16 shrink-0 text-center">
                <p className="text-xs font-semibold uppercase text-muted">{fmtDay(e.startsAt, tz).split(",")[0]}</p>
                <p className="font-display text-base font-semibold leading-tight">{fmtDay(e.startsAt, tz).split(", ")[1]}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-medium", e.status === "cancelled" && "line-through")}>{e.title}</p>
                <p className="truncate text-sm text-muted">
                  {fmtRange(e.startsAt, e.endsAt, tz)}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
              </div>
              {e.status !== "published" ? (
                <Badge tone={e.status === "draft" ? "warn" : "danger"}>{e.status === "draft" ? "Draft" : "Cancelled"}</Badge>
              ) : null}
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nothing scheduled"
          body="Build rehearsals by scene and everyone gets their call times automatically."
          action={<LinkButton href={`${base}/schedule`}>Open schedule</LinkButton>}
        />
      )}

      <SectionTitle>Resources</SectionTitle>
      <Link href={`${base}/resources`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-surface-2">
        <Link2 className="size-5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Scripts, tracks & videos</span>
          <span className="block text-sm text-muted">
            {resourceCount.n ? `${plural(resourceCount.n, "link")} shared with the cast` : "Share links with the whole cast or one role"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" />
      </Link>

      <SectionTitle>Announcements</SectionTitle>
      <AnnouncementList rows={anns} tz={tz} canEdit productionId={productionId} />
      <details className="mt-3 rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-sm font-semibold text-accent">
          + New announcement
        </summary>
        <div className="border-t border-line p-4">
          <AnnouncementForm action={postAnnouncement.bind(null, productionId)} />
        </div>
      </details>
    </div>
  );
}
