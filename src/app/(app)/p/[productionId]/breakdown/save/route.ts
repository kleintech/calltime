import { revalidatePath } from "next/cache";
import { getProductionAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { ActionError } from "@/lib/production-queries";
import { applyChanges, changesSchema } from "../apply";

/**
 * POST /p/<id>/breakdown/save — the breakdown grid's unload path. When the page is closing with
 * taps still queued, the client sends them with navigator.sendBeacon (server actions can't run
 * during unload). Same-origin cookie auth, same validation and call-impact handling as the action.
 */
export async function POST(req: Request, ctx: RouteContext<"/p/[productionId]/breakdown/save">) {
  const { productionId } = await ctx.params;
  // CSRF: a beacon is same-origin; reject cross-site posts.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return new Response("Forbidden", { status: 403 });

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const access = await getProductionAccess(user, productionId);
  if (!access?.canEdit) return new Response("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const parsed = changesSchema.safeParse(body);
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  try {
    const affected = await applyChanges(productionId, user.id, parsed.data);
    revalidatePath(`/p/${productionId}`, "layout");
    return Response.json({ ok: true, affected });
  } catch (e) {
    if (e instanceof ActionError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
