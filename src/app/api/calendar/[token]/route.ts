import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { appBaseUrl } from "@/lib/invites";
import { buildUserFeed } from "./feed";

/**
 * Personal iCalendar subscription feed: GET /api/calendar/<users.calendarToken>[.ics]
 * The token is the only credential (calendar apps can't send cookies); rotate it from
 * /home/calendar to revoke existing subscriptions.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token: raw } = await ctx.params;
  // Next has already decoded the segment; decoding again would throw on a literal "%".
  const token = raw.replace(/\.ics$/i, "");
  if (!token || token.length > 200) return notFound();

  const user = await db.query.users.findFirst({ where: eq(users.calendarToken, token) });
  if (!user) return notFound();

  const body = await buildUserFeed(user, await appBaseUrl());
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calltime.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}

function notFound() {
  return new Response("Calendar not found. The link may have been reset — get a new one in Calltime.\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
