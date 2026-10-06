import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditionSignups } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { getAuditionForProduction } from "@/lib/auditions";
import { BackLink, Badge } from "@/components/ui";
import { SubTabs } from "../_components/sub-tabs";

export default async function AuditionLayout({ children, params }: LayoutProps<"/p/[productionId]/auditions/[auditionId]">) {
  const { productionId, auditionId } = await params;
  await requireProductionEditor(productionId);
  const audition = await getAuditionForProduction(productionId, auditionId);
  const counts = await db
    .select({ status: auditionSignups.status, n: sql<number>`count(*)::int` })
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), ne(auditionSignups.status, "withdrawn")))
    .groupBy(auditionSignups.status);
  const total = counts.reduce((a, c) => a + c.n, 0);
  const callbacks = counts.find((c) => c.status === "callback")?.n ?? 0;
  const base = `/p/${productionId}/auditions/${auditionId}`;

  return (
    <div>
      <div className="mb-4 print:hidden">
        <BackLink href={`/p/${productionId}/auditions`} label="All auditions" />
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{audition.title}</h2>
          <Badge tone={audition.isOpen ? "success" : "neutral"} dot>
            {audition.isOpen ? "Open" : "Closed"}
          </Badge>
        </div>
        <a
          href={`/audition/${audition.slug}`}
          target="_blank"
          className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
        >
          Public page: /audition/{audition.slug} ↗
        </a>
      </div>
      <SubTabs
        base={base}
        tabs={[
          { slug: "signups", label: "Signups", count: total },
          { slug: "checkin", label: "Check-in" },
          { slug: "slots", label: "Slots" },
          { slug: "callbacks", label: "Callbacks", count: callbacks },
          { slug: "casting", label: "Casting" },
          { slug: "settings", label: "Settings" },
        ]}
      />
      {children}
    </div>
  );
}
