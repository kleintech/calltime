import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditionSignups, auditionSlots } from "@/db/schema";
import { buildIcs, getPublicAudition } from "@/lib/auditions";

/** Single-file calendar download for an auditioner's slot (and callback, if scheduled). */
export async function GET(_req: Request, ctx: RouteContext<"/audition/[slug]/me/[token]/calendar.ics">) {
  const { slug, token } = await ctx.params;
  const row = await getPublicAudition(slug);
  if (!row) return new Response("Not found", { status: 404 });
  const signup = await db.query.auditionSignups.findFirst({
    where: and(eq(auditionSignups.manageToken, token), eq(auditionSignups.auditionId, row.audition.id)),
  });
  if (!signup || signup.status === "withdrawn") return new Response("Not found", { status: 404 });
  const ids = [signup.slotId, signup.status === "callback" ? signup.callbackSlotId : null].filter((x): x is string => !!x);
  const slots = ids.length ? await db.select().from(auditionSlots).where(inArray(auditionSlots.id, ids)) : [];
  if (slots.length === 0) return new Response("No time scheduled yet", { status: 404 });
  const ics = buildIcs(
    slots.map((s) => ({
      uid: `${signup.id}-${s.id}`,
      start: s.startsAt,
      end: s.endsAt,
      summary: `${signup.firstName}: ${row.production.title} ${s.kind === "callback" ? "callback" : "audition"}`,
      location: s.location ?? row.audition.location,
      description: `${row.audition.title} — ${signup.firstName} ${signup.lastName}${s.label ? `\n${s.label}` : ""}`,
    })),
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="audition-${slug}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
