import { and, eq, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { getAuditionForProduction } from "@/lib/auditions";
import { Badge } from "@/components/ui";
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
        <Link href={`/p/${productionId}/auditions`} className="text-sm text-muted hover:text-ink">
          ← All auditions
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold tracking-tight">{audition.title}</h2>
          <Badge tone={audition.isOpen ? "success" : "neutral"}>{audition.isOpen ? "Open" : "Closed"}</Badge>
          <a href={`/audition/${audition.slug}`} target="_blank" className="text-sm text-accent hover:underline">
            /audition/{audition.slug}
          </a>
        </div>
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
