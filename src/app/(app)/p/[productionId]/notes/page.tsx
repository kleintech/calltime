import { and, asc, desc, eq, exists, inArray, isNotNull, isNull } from "drizzle-orm";
import { Check, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { actorNoteRecipients, actorNotes, events, people, scenes } from "@/db/schema";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { sceneLabel } from "@/lib/calls";
import { CATEGORY_LABEL, getProductionCast, isCategory, NOTE_CATEGORIES, recentEvents, recentlyNotedPersonIds } from "@/lib/notes";
import { dayKey, fmtDateTime, fmtDay } from "@/lib/time";
import { Badge, Button, Card, EmptyState, SectionTitle, Select, cn } from "@/components/ui";
import { ConfirmButton } from "../auditions/_components/forms";
import { deleteNote, toggleResolved } from "./actions";
import { NoteEntry } from "./note-entry";

type NoteRow = typeof actorNotes.$inferSelect;
type Recipient = { noteId: string; personId: string; readAt: Date | null; firstName: string; lastName: string };

async function loadRecipients(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, Recipient[]>();
  const rows = await db
    .select({
      noteId: actorNoteRecipients.noteId,
      personId: actorNoteRecipients.personId,
      readAt: actorNoteRecipients.readAt,
      firstName: people.firstName,
      lastName: people.lastName,
    })
    .from(actorNoteRecipients)
    .innerJoin(people, eq(people.id, actorNoteRecipients.personId))
    .where(inArray(actorNoteRecipients.noteId, noteIds))
    .orderBy(asc(people.firstName));
  const m = new Map<string, Recipient[]>();
  for (const r of rows) m.set(r.noteId, [...(m.get(r.noteId) ?? []), r]);
  return m;
}

export default async function NotesPage({ params, searchParams }: PageProps<"/p/[productionId]/notes">) {
  const { productionId } = await params;
  const sp = await searchParams;
  const { canEdit, org, user } = await requireProductionAccess(productionId);
  const tz = org.timezone;

  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.productionId, productionId))
    .orderBy(asc(scenes.act), asc(scenes.sortOrder), asc(scenes.number));
  const sceneName = new Map(sceneRows.map((s) => [s.id, sceneLabel(s)]));
  const meta = (n: NoteRow) =>
    [CATEGORY_LABEL[isCategory(n.category) ? n.category : "general"], n.sceneId ? sceneName.get(n.sceneId) : null].filter(Boolean).join(" · ");

  if (!canEdit) {
    /* ───── Family / performer view: notes for the people I cover ───── */
    const covered = await getCoveredPersonIds(user.id);
    const person = typeof sp.person === "string" && covered.includes(sp.person) ? sp.person : null;
    const scope = person ? [person] : covered;
    const notes = scope.length
      ? await db
          .select()
          .from(actorNotes)
          .where(
            and(
              eq(actorNotes.productionId, productionId),
              exists(
                db
                  .select({ x: actorNoteRecipients.noteId })
                  .from(actorNoteRecipients)
                  .where(and(eq(actorNoteRecipients.noteId, actorNotes.id), inArray(actorNoteRecipients.personId, scope))),
              ),
            ),
          )
          .orderBy(desc(actorNotes.createdAt))
          .limit(200)
      : [];
    const recips = await loadRecipients(notes.map((n) => n.id));
    const mine = (id: string) => (recips.get(id) ?? []).filter((r) => covered.includes(r.personId));
    const kids = [...new Map(notes.flatMap((n) => mine(n.id)).map((r) => [r.personId, r])).values()];
    const unread = notes.filter((n) => mine(n.id).some((r) => !r.readAt)).length;

    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Notes</h2>
            <p className="text-sm text-muted">From the director and creative team</p>
          </div>
          {unread ? <Badge tone="accent">{unread} new</Badge> : null}
        </div>
        {kids.length > 1 || person ? (
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
            {[{ personId: null as string | null, firstName: "All" }, ...kids].map((k) => (
              <Link
                key={k.personId ?? "all"}
                href={k.personId ? `?person=${k.personId}` : "?"}
                className={cn(
                  "flex min-h-11 items-center rounded-full border px-4 text-base",
                  person === k.personId ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface",
                )}
              >
                {k.firstName}
              </Link>
            ))}
          </div>
        ) : null}
        {notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            body="When the director or creative team gives a note after a rehearsal, it shows up here."
          />
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {notes.map((n) => {
              const rs = mine(n.id);
              const isNew = rs.some((r) => !r.readAt);
              return (
                <Link key={n.id} href={`/p/${productionId}/notes/${n.id}`} className="flex gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className={cn("mt-2 size-2.5 shrink-0 rounded-full", isNew ? "bg-accent" : "bg-transparent")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{rs.map((r) => r.firstName).join(" & ")}</span>
                      <span className="text-muted">{meta(n)}</span>
                      {isNew ? <Badge tone="accent">New</Badge> : null}
                    </div>
                    <p className={cn("mt-0.5 line-clamp-2 text-base", isNew && "font-medium")}>{n.body}</p>
                    <p className="mt-0.5 text-sm text-muted">{fmtDay(n.createdAt, tz)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ───── Creative team view: fast entry + filterable list ───── */
  const cast = await getProductionCast(productionId);
  const castIds = new Set(cast.map((c) => c.id));
  const recent = await recentlyNotedPersonIds(productionId);
  const evs = await recentEvents(productionId);
  const todayKey = dayKey(new Date(), tz);
  const todays = evs.find((e) => dayKey(e.startsAt, tz) === todayKey);

  const fPerson = typeof sp.person === "string" && castIds.has(sp.person) ? sp.person : "";
  const fScene = typeof sp.scene === "string" && sceneName.has(sp.scene) ? sp.scene : "";
  const fCat = typeof sp.category === "string" && isCategory(sp.category) ? sp.category : "";
  const fStatus = sp.status === "resolved" || sp.status === "all" ? sp.status : "open";

  const notes = await db
    .select({ n: actorNotes, eventTitle: events.title, eventStart: events.startsAt })
    .from(actorNotes)
    .leftJoin(events, eq(events.id, actorNotes.eventId))
    .where(
      and(
        eq(actorNotes.productionId, productionId),
        fScene ? eq(actorNotes.sceneId, fScene) : undefined,
        fCat ? eq(actorNotes.category, fCat) : undefined,
        fStatus === "open" ? isNull(actorNotes.resolvedAt) : fStatus === "resolved" ? isNotNull(actorNotes.resolvedAt) : undefined,
        fPerson
          ? exists(
              db
                .select({ x: actorNoteRecipients.noteId })
                .from(actorNoteRecipients)
                .where(and(eq(actorNoteRecipients.noteId, actorNotes.id), eq(actorNoteRecipients.personId, fPerson))),
            )
          : undefined,
      ),
    )
    .orderBy(desc(actorNotes.createdAt))
    .limit(200);
  const recips = await loadRecipients(notes.map((r) => r.n.id));
  const filtered = !!(fPerson || fScene || fCat || fStatus !== "open");

  return (
    <div>
      {cast.length === 0 ? (
        <EmptyState title="No cast yet" body="Notes go to cast members. Cast the show first, then give notes here during runs." />
      ) : (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
            <MessageSquareText className="size-5 text-accent" aria-hidden /> New note
          </h2>
          <NoteEntry
            productionId={productionId}
            people={cast}
            recent={recent}
            scenes={sceneRows.map((s) => ({ id: s.id, label: sceneLabel(s) }))}
            events={evs.map((e) => ({ id: e.id, label: `${fmtDay(e.startsAt, tz)} · ${e.title}` }))}
            defaultEventId={todays?.id}
          />
        </Card>
      )}

      <SectionTitle>Notes{notes.length ? ` (${notes.length})` : ""}</SectionTitle>
      <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select name="person" defaultValue={fPerson} aria-label="Filter by person">
          <option value="">Everyone</option>
          {cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select name="scene" defaultValue={fScene} aria-label="Filter by scene">
          <option value="">All scenes</option>
          {sceneRows.map((s) => (
            <option key={s.id} value={s.id}>
              {sceneLabel(s)}
            </option>
          ))}
        </Select>
        <Select name="category" defaultValue={fCat} aria-label="Filter by category">
          <option value="">All categories</option>
          {NOTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={fStatus} aria-label="Filter by status">
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">Open & resolved</option>
        </Select>
        <div className="col-span-2 flex gap-2 sm:col-span-4">
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          {filtered ? (
            <Link href={`/p/${productionId}/notes`} className="inline-flex min-h-11 items-center px-3 text-sm text-muted hover:text-ink">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {notes.length === 0 ? (
        <EmptyState
          title={filtered ? "No notes match" : "No open notes"}
          body={filtered ? "Try different filters." : "Notes you give show up here. Families see notes for their performer."}
        />
      ) : (
        <div className="space-y-3">
          {notes.map(({ n, eventTitle, eventStart }) => {
            const rs = recips.get(n.id) ?? [];
            return (
              <Card key={n.id} className={cn("space-y-2", n.resolvedAt && "opacity-70")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Badge tone="accent">{CATEGORY_LABEL[isCategory(n.category) ? n.category : "general"]}</Badge>
                  {n.sceneId ? <span className="text-muted">{sceneName.get(n.sceneId)}</span> : null}
                  {n.resolvedAt ? (
                    <Badge tone="success">
                      <Check className="size-3" aria-hidden /> Resolved
                    </Badge>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-base">{n.body}</p>
                <div className="flex flex-wrap gap-1.5">
                  {rs.map((r) => (
                    <span key={r.personId} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-sm">
                      {r.firstName} {r.lastName}
                      {r.readAt ? (
                        <span className="inline-flex items-center text-success" title={`Read ${fmtDateTime(r.readAt, tz)}`}>
                          <Check className="size-3.5" aria-hidden />
                          <span className="sr-only">read</span>
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                  <span className="text-xs text-muted">
                    {fmtDateTime(n.createdAt, tz)}
                    {eventTitle && eventStart ? ` · ${fmtDay(eventStart, tz)} ${eventTitle}` : ""}
                  </span>
                  <div className="flex gap-2">
                    <form action={toggleResolved}>
                      <input type="hidden" name="productionId" value={productionId} />
                      <input type="hidden" name="noteId" value={n.id} />
                      <Button type="submit" variant="secondary" className="min-h-10 px-3">
                        {n.resolvedAt ? "Reopen" : "Mark resolved"}
                      </Button>
                    </form>
                    <form action={deleteNote}>
                      <input type="hidden" name="productionId" value={productionId} />
                      <input type="hidden" name="noteId" value={n.id} />
                      <ConfirmButton variant="ghost" className="min-h-10 px-3 text-danger" message="Delete this note? Families will no longer see it.">
                        Delete
                      </ConfirmButton>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
