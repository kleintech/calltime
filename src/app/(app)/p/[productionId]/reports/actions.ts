"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { events, rehearsalReports, scenes } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { isUuid } from "@/lib/auditions";
import { DEPARTMENTS } from "@/lib/notes";

export type ReportState = { error?: string; ok?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveReport(_: ReportState, fd: FormData): Promise<ReportState> {
  const productionId = str(fd, "productionId");
  const eventId = str(fd, "eventId");
  if (!isUuid(productionId) || !isUuid(eventId)) return { error: "Missing rehearsal." };
  const { user } = await requireProductionEditor(productionId);
  const event = await db.query.events.findFirst({ where: and(eq(events.id, eventId), eq(events.productionId, productionId)) });
  if (!event) return { error: "That rehearsal isn't part of this production." };

  const existing = await db.query.rehearsalReports.findFirst({ where: eq(rehearsalReports.eventId, eventId) });
  if (existing && !existing.publishedAt && existing.authorUserId && existing.authorUserId !== user.id) {
    return { error: "Someone else is drafting this report." };
  }

  const wanted = fd.getAll("scenesCovered").map(String).filter(isUuid);
  const valid = wanted.length
    ? (await db.select({ id: scenes.id }).from(scenes).where(and(eq(scenes.productionId, productionId), inArray(scenes.id, wanted)))).map((s) => s.id)
    : [];
  const scenesCovered = wanted.filter((id) => valid.includes(id));
  const departmentNotes: Record<string, string> = {};
  for (const d of DEPARTMENTS) {
    const v = str(fd, `dept_${d.key}`).slice(0, 8000);
    if (v) departmentNotes[d.key] = v;
  }
  const summary = str(fd, "summary").slice(0, 20000) || null;
  const intent = str(fd, "intent");
  const publishedAt =
    intent === "publish" ? (existing?.publishedAt ?? new Date()) : intent === "unpublish" ? null : (existing?.publishedAt ?? null);

  await db
    .insert(rehearsalReports)
    .values({ productionId, eventId, authorUserId: user.id, summary, scenesCovered, departmentNotes, publishedAt })
    .onConflictDoUpdate({
      target: rehearsalReports.eventId,
      set: { summary, scenesCovered, departmentNotes, publishedAt, updatedAt: new Date() },
    });
  revalidatePath(`/p/${productionId}/reports`, "layout");
  return {
    ok:
      intent === "publish"
        ? existing?.publishedAt
          ? "Saved. The creative team sees the update."
          : "Published to the creative team."
        : intent === "unpublish"
          ? "Unpublished. Only you can see this draft now."
          : publishedAt
            ? "Saved. The creative team sees the update."
            : "Draft saved. Only you can see it until you publish.",
  };
}
