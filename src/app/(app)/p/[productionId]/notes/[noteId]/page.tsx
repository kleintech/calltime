import { and, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { actorNoteRecipients, actorNotes, events, people, scenes, users } from "@/db/schema";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { isUuid } from "@/lib/auditions";
import { sceneLabel } from "@/lib/calls";
import { CATEGORY_LABEL, isCategory } from "@/lib/notes";
import { fmtDateTime, fmtDay } from "@/lib/time";
import { BackLink, Badge, Card } from "@/components/ui";
import { MarkRead } from "./mark-read";

export default async function NoteDetail({ params }: PageProps<"/p/[productionId]/notes/[noteId]">) {
  const { productionId, noteId } = await params;
  const { canEdit, org, user } = await requireProductionAccess(productionId);
  const tz = org.timezone;
  if (!isUuid(noteId)) notFound();
  const note = await db.query.actorNotes.findFirst({
    where: and(eq(actorNotes.id, noteId), eq(actorNotes.productionId, productionId)),
  });
  if (!note) notFound();

  const recips = await db
    .select({ personId: actorNoteRecipients.personId, readAt: actorNoteRecipients.readAt, firstName: people.firstName, lastName: people.lastName })
    .from(actorNoteRecipients)
    .innerJoin(people, eq(people.id, actorNoteRecipients.personId))
    .where(eq(actorNoteRecipients.noteId, noteId));
  const covered = canEdit ? [] : await getCoveredPersonIds(user.id);
  const visible = canEdit ? recips : recips.filter((r) => covered.includes(r.personId));
  if (!canEdit && visible.length === 0) notFound(); // not a note for anyone this family covers

  const [scene, event, author] = await Promise.all([
    note.sceneId ? db.query.scenes.findFirst({ where: eq(scenes.id, note.sceneId) }) : null,
    note.eventId ? db.query.events.findFirst({ where: eq(events.id, note.eventId) }) : null,
    note.authorUserId ? db.query.users.findFirst({ where: eq(users.id, note.authorUserId), columns: { name: true } }) : null,
  ]);
  const unreadForMe = !canEdit && visible.some((r) => !r.readAt);

  return (
    <div className="space-y-4">
      {unreadForMe ? <MarkRead productionId={productionId} noteId={noteId} /> : null}
      <BackLink href={`/p/${productionId}/notes`} label="Notes" />
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{CATEGORY_LABEL[isCategory(note.category) ? note.category : "general"]}</Badge>
          {scene ? <span className="text-sm text-muted">{sceneLabel(scene)}</span> : null}
          {note.resolvedAt && canEdit ? <Badge tone="success">Resolved</Badge> : null}
        </div>
        <p className="text-sm font-semibold">For {visible.map((r) => `${r.firstName} ${r.lastName}`.trim()).join(", ")}</p>
        <p className="whitespace-pre-wrap text-lg leading-relaxed">{note.body}</p>
        <p className="border-t border-line pt-3 text-sm text-muted">
          {author?.name ? `${author.name} · ` : ""}
          {fmtDateTime(note.createdAt, tz)}
          {event ? ` · from ${fmtDay(event.startsAt, tz)} ${event.title}` : ""}
        </p>
      </Card>
      {canEdit ? (
        <Card>
          <p className="mb-2 text-sm font-semibold">Read by</p>
          <ul className="space-y-1 text-sm">
            {recips.map((r) => (
              <li key={r.personId} className="flex items-center justify-between gap-2">
                <span>
                  {r.firstName} {r.lastName}
                </span>
                {r.readAt ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Check className="size-4" aria-hidden /> {fmtDateTime(r.readAt, tz)}
                  </span>
                ) : (
                  <span className="text-muted">Not yet</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
