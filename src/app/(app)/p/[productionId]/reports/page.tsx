import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { ChevronRight, ClipboardList } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { events, rehearsalReports, users } from "@/db/schema";
import { requireProductionAccess } from "@/lib/access";
import { recentEvents } from "@/lib/notes";
import { fmtDay, fmtRange } from "@/lib/time";
import { Badge, EmptyState, List, ListRow, SectionTitle } from "@/components/ui";

export default async function ReportsPage({ params }: PageProps<"/p/[productionId]/reports">) {
  const { productionId } = await params;
  const { canEdit, creativeTitle, org, user } = await requireProductionAccess(productionId);
  if (!canEdit && !creativeTitle) redirect(`/p/${productionId}`);
  const tz = org.timezone;

  // Published reports for the team, plus my own drafts.
  const reports = await db
    .select({ r: rehearsalReports, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, author: users.name })
    .from(rehearsalReports)
    .innerJoin(events, eq(events.id, rehearsalReports.eventId))
    .leftJoin(users, eq(users.id, rehearsalReports.authorUserId))
    .where(
      and(
        eq(rehearsalReports.productionId, productionId),
        or(isNotNull(rehearsalReports.publishedAt), eq(rehearsalReports.authorUserId, user.id)),
      ),
    )
    .orderBy(desc(events.startsAt));

  const evs = canEdit ? await recentEvents(productionId, 14) : [];
  const taken = evs.length
    ? await db
        .select({ eventId: rehearsalReports.eventId })
        .from(rehearsalReports)
        .where(inArray(rehearsalReports.eventId, evs.map((e) => e.id)))
    : [];
  const takenIds = new Set(taken.map((t) => t.eventId));
  const open = evs.filter((e) => !takenIds.has(e.id)).slice(0, 6);

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-xl font-semibold">Rehearsal reports</h2>
        <p className="text-sm text-muted">Shared with the creative team only. Families never see these.</p>
      </div>

      {canEdit ? (
        <>
          <SectionTitle>Write a report</SectionTitle>
          {open.length ? (
            <List>
              {open.map((e) => (
                <ListRow
                  key={e.id}
                  href={`/p/${productionId}/reports/${e.id}`}
                  title={e.title}
                  subtitle={`${fmtDay(e.startsAt, tz)} · ${fmtRange(e.startsAt, e.endsAt, tz)}`}
                  right={<ChevronRight className="size-4 text-muted" aria-hidden />}
                />
              ))}
            </List>
          ) : (
            <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-muted">
              Every recent rehearsal has a report. New rehearsals show up here once they start.
            </p>
          )}
        </>
      ) : null}

      <SectionTitle>Reports</SectionTitle>
      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          body="After each rehearsal the stage manager logs what was covered and notes for each department. Published reports appear here."
        />
      ) : (
        <List>
          {reports.map(({ r, title, startsAt, author }) => (
            <ListRow
              key={r.id}
              href={`/p/${productionId}/reports/${r.eventId}`}
              title={
                <span className="flex items-center gap-2">
                  <ClipboardList className="size-4 shrink-0 text-accent" aria-hidden />
                  {fmtDay(startsAt, tz)} · {title}
                </span>
              }
              subtitle={r.summary ? r.summary.slice(0, 120) : author ? `By ${author}` : undefined}
              right={r.publishedAt ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
            />
          ))}
        </List>
      )}
    </div>
  );
}
