import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { attendance, events, people, scenes, users } from "@/db/schema";
import { requireProductionAccess } from "@/lib/access";
import { isUuid } from "@/lib/auditions";
import { sceneLabel } from "@/lib/calls";
import { DEPARTMENTS, getReportForEvent, scenesForEvent } from "@/lib/notes";
import { fmtDateTime, fmtDayLong, fmtRange } from "@/lib/time";
import { BackLink, Badge, Card, Notice, SectionTitle } from "@/components/ui";
import { ReportForm } from "../report-form";

export default async function ReportPage({ params }: PageProps<"/p/[productionId]/reports/[eventId]">) {
  const { productionId, eventId } = await params;
  const { canEdit, creativeTitle, org, user } = await requireProductionAccess(productionId);
  if (!canEdit && !creativeTitle) redirect(`/p/${productionId}`);
  const tz = org.timezone;
  if (!isUuid(eventId)) notFound();
  const event = await db.query.events.findFirst({ where: and(eq(events.id, eventId), eq(events.productionId, productionId)) });
  if (!event) notFound();

  const report = await getReportForEvent(eventId);
  const isAuthor = !report?.authorUserId || report.authorUserId === user.id;
  if (report && !report.publishedAt && !isAuthor) {
    // Someone else's draft is private to them.
    return (
      <div className="space-y-4">
        <BackLink href={`/p/${productionId}/reports`} label="Reports" />
        <Notice>A report for this rehearsal is being drafted. You&apos;ll see it here once it&apos;s published.</Notice>
      </div>
    );
  }

  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.productionId, productionId))
    .orderBy(asc(scenes.act), asc(scenes.sortOrder), asc(scenes.number));
  const covered = report ? report.scenesCovered : await scenesForEvent(eventId);
  const author = report?.authorUserId ? await db.query.users.findFirst({ where: eq(users.id, report.authorUserId), columns: { name: true } }) : null;
  const att = await db
    .select({ status: attendance.status, note: attendance.note, firstName: people.firstName, lastName: people.lastName })
    .from(attendance)
    .innerJoin(people, eq(people.id, attendance.personId))
    .where(eq(attendance.eventId, eventId))
    .orderBy(asc(people.firstName));
  const notPresent = att.filter((a) => a.status !== "present");
  const sceneName = new Map(sceneRows.map((s) => [s.id, sceneLabel(s)]));

  return (
    <div className="space-y-4">
      <BackLink href={`/p/${productionId}/reports`} label="Reports" />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold">{event.title}</h2>
          {report?.publishedAt ? <Badge tone="success">Published</Badge> : report ? <Badge>Draft — only you can see this</Badge> : null}
        </div>
        <p className="text-sm text-muted">
          {fmtDayLong(event.startsAt, tz)} · {fmtRange(event.startsAt, event.endsAt, tz)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {report ? (
          <p className="mt-1 text-xs text-muted">
            {author?.name ? `By ${author.name} · ` : ""}Updated {fmtDateTime(report.updatedAt, tz)}
          </p>
        ) : null}
      </div>

      {att.length ? (
        <Card className="space-y-1 text-sm">
          <p className="font-semibold">
            Attendance: {att.length - notPresent.length} present
            {notPresent.length ? `, ${notPresent.length} not` : ""}
          </p>
          {notPresent.map((a, i) => (
            <p key={i} className="text-muted">
              {a.firstName} {a.lastName} — {a.status.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase())}
              {a.note ? ` (${a.note})` : ""}
            </p>
          ))}
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          {!report && covered.length ? (
            <p className="mb-3 text-sm text-muted">Scenes covered are filled in from the rehearsal plan. Adjust if you ran something else.</p>
          ) : null}
          <ReportForm
            productionId={productionId}
            eventId={eventId}
            summary={report?.summary ?? ""}
            scenes={sceneRows.map((s) => ({ id: s.id, label: sceneLabel(s) }))}
            covered={covered}
            departments={DEPARTMENTS}
            notes={report?.departmentNotes ?? {}}
            published={!!report?.publishedAt}
          />
        </Card>
      ) : report ? (
        <>
          <Card className="space-y-3">
            {report.summary ? <p className="whitespace-pre-wrap text-base">{report.summary}</p> : null}
            {report.scenesCovered.length ? (
              <p className="text-sm">
                <span className="font-semibold">Scenes covered:</span> {report.scenesCovered.map((id) => sceneName.get(id)).filter(Boolean).join(", ")}
              </p>
            ) : null}
          </Card>
          <SectionTitle>Department notes</SectionTitle>
          <Card className="space-y-3">
            {DEPARTMENTS.filter((d) => report.departmentNotes[d.key]).map((d) => (
              <div key={d.key}>
                <p className="text-sm font-semibold">{d.label}</p>
                <p className="whitespace-pre-wrap text-sm">{report.departmentNotes[d.key]}</p>
              </div>
            ))}
            {DEPARTMENTS.every((d) => !report.departmentNotes[d.key]) ? <p className="text-sm text-muted">No department notes.</p> : null}
          </Card>
        </>
      ) : (
        <Notice>No report for this rehearsal yet.</Notice>
      )}
    </div>
  );
}
