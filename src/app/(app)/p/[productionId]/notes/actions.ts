"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { actorNoteRecipients, actorNotes, events, roleAssignments, roles, scenes } from "@/db/schema";
import { getCoveredPersonIds, requireProductionAccess, requireProductionEditor } from "@/lib/access";
import { isUuid } from "@/lib/auditions";
import { NOTE_CATEGORIES } from "@/lib/notes";

export type NoteFormState = { error?: string; ok?: string; savedAt?: number };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function editor(fd: FormData) {
  const productionId = str(fd, "productionId");
  if (!isUuid(productionId)) throw new Error("Bad production");
  return { ...(await requireProductionEditor(productionId)), productionId };
}

export async function createNote(_: NoteFormState, fd: FormData): Promise<NoteFormState> {
  const ctx = await editor(fd);
  const body = str(fd, "body");
  if (!body) return { error: "Type the note first." };
  if (body.length > 4000) return { error: "That note is too long — keep it under 4000 characters." };
  const category = z.enum(NOTE_CATEGORIES).catch("general").parse(str(fd, "category"));

  // Recipients must be cast in this production.
  const wanted = fd.getAll("personIds").map(String).filter(isUuid);
  if (wanted.length === 0) return { error: "Pick who the note is for." };
  const cast = await db
    .selectDistinct({ personId: roleAssignments.personId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roles.productionId, ctx.productionId), inArray(roleAssignments.personId, wanted)));
  const personIds = cast.map((c) => c.personId);
  if (personIds.length === 0) return { error: "Those people aren't in this cast." };

  const sceneRaw = str(fd, "sceneId");
  let sceneId: string | null = null;
  if (isUuid(sceneRaw)) {
    const s = await db.query.scenes.findFirst({ where: and(eq(scenes.id, sceneRaw), eq(scenes.productionId, ctx.productionId)) });
    sceneId = s?.id ?? null;
  }
  const eventRaw = str(fd, "eventId");
  let eventId: string | null = null;
  if (isUuid(eventRaw)) {
    const e = await db.query.events.findFirst({ where: and(eq(events.id, eventRaw), eq(events.productionId, ctx.productionId)) });
    eventId = e?.id ?? null;
  }

  await db.transaction(async (tx) => {
    const [note] = await tx
      .insert(actorNotes)
      .values({ productionId: ctx.productionId, eventId, sceneId, authorUserId: ctx.user.id, category, body })
      .returning();
    await tx.insert(actorNoteRecipients).values(personIds.map((personId) => ({ noteId: note.id, personId })));
  });
  revalidatePath(`/p/${ctx.productionId}/notes`, "layout");
  return { ok: `Note saved for ${personIds.length} ${personIds.length === 1 ? "person" : "people"}.`, savedAt: Date.now() };
}

async function editorNote(fd: FormData) {
  const ctx = await editor(fd);
  const noteId = str(fd, "noteId");
  if (!isUuid(noteId)) throw new Error("Bad note");
  const note = await db.query.actorNotes.findFirst({
    where: and(eq(actorNotes.id, noteId), eq(actorNotes.productionId, ctx.productionId)),
  });
  if (!note) throw new Error("Note not found");
  return { ...ctx, note };
}

export async function toggleResolved(fd: FormData) {
  const ctx = await editorNote(fd);
  await db
    .update(actorNotes)
    .set({ resolvedAt: ctx.note.resolvedAt ? null : new Date() })
    .where(eq(actorNotes.id, ctx.note.id));
  revalidatePath(`/p/${ctx.productionId}/notes`, "layout");
}

export async function deleteNote(fd: FormData) {
  const ctx = await editorNote(fd);
  await db.delete(actorNotes).where(eq(actorNotes.id, ctx.note.id));
  revalidatePath(`/p/${ctx.productionId}/notes`, "layout");
}

/**
 * Mark a note read for every recipient the viewer covers (themselves and/or their wards).
 * Called when a family member opens the note.
 */
export async function markNoteRead(productionId: string, noteId: string) {
  if (!isUuid(productionId) || !isUuid(noteId)) return;
  const { user } = await requireProductionAccess(productionId);
  const covered = await getCoveredPersonIds(user.id);
  if (covered.length === 0) return;
  const note = await db.query.actorNotes.findFirst({
    where: and(eq(actorNotes.id, noteId), eq(actorNotes.productionId, productionId)),
  });
  if (!note) return;
  await db
    .update(actorNoteRecipients)
    .set({ readAt: new Date() })
    .where(and(eq(actorNoteRecipients.noteId, noteId), inArray(actorNoteRecipients.personId, covered), isNull(actorNoteRecipients.readAt)));
  revalidatePath(`/p/${productionId}/notes`, "layout");
}
