import { eq, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { buildDigest, digestSubject, renderDigestHtml, renderDigestText } from "@/lib/digest";
import { appBaseUrl } from "@/lib/invites";

/**
 * Preview the weekly digest email: GET /api/digest/preview[?user=<id|email>][&format=text]
 * Signed-in users see their own; platform admins may preview anyone's.
 */
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.\n", { status: 401, headers: { "Content-Type": "text/plain" } });

  const wanted = req.nextUrl.searchParams.get("user")?.trim();
  let target = me;
  if (wanted && wanted !== me.id && wanted.toLowerCase() !== me.email) {
    if (!me.isPlatformAdmin) return new Response("Not allowed.\n", { status: 403, headers: { "Content-Type": "text/plain" } });
    const isUuid = /^[0-9a-f-]{36}$/i.test(wanted);
    const found = await db.query.users.findFirst({
      where: isUuid ? or(eq(users.id, wanted), eq(users.email, wanted.toLowerCase())) : eq(users.email, wanted.toLowerCase()),
    });
    if (!found) return new Response("No such user.\n", { status: 404, headers: { "Content-Type": "text/plain" } });
    target = found;
  }

  const digest = await buildDigest(target.id);
  if (!digest) return new Response("No such user.\n", { status: 404 });
  const base = await appBaseUrl();
  const headers = { "Cache-Control": "no-store", "X-Digest-Subject": encodeURIComponent(digestSubject(digest)) };
  if (req.nextUrl.searchParams.get("format") === "text")
    return new Response(renderDigestText(digest, base), { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(renderDigestHtml(digest, base), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
