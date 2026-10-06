import { asc, desc, eq, sql } from "drizzle-orm";
import { ChevronRight, Plus } from "lucide-react";
import { db } from "@/db";
import { auditionSignups, auditionSlots, auditions } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { Badge, Card, EmptyState, List, ListRow, SectionTitle } from "@/components/ui";
import { fmtDay } from "@/lib/time";
import { appBaseUrl } from "@/lib/invites";
import { CopyButton } from "@/components/copy-button";
import { createAudition } from "./actions";
import { AuditionForm } from "./_components/forms";

export default async function AuditionsIndex({ params }: PageProps<"/p/[productionId]/auditions">) {
  const { productionId } = await params;
  const { org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const base = await appBaseUrl();

  const rows = await db
    .select({
      audition: auditions,
      signups: sql<number>`(select count(*)::int from ${auditionSignups} where ${auditionSignups.auditionId} = ${auditions.id} and ${auditionSignups.status} <> 'withdrawn')`,
      firstSlot: sql<string | null>`(select min(${auditionSlots.startsAt}) from ${auditionSlots} where ${auditionSlots.auditionId} = ${auditions.id})`,
      lastSlot: sql<string | null>`(select max(${auditionSlots.startsAt}) from ${auditionSlots} where ${auditionSlots.auditionId} = ${auditions.id})`,
    })
    .from(auditions)
    .where(eq(auditions.productionId, productionId))
    .orderBy(desc(auditions.isOpen), asc(auditions.createdAt));

  const hidden = { productionId };

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState
          title="No auditions yet"
          body="Create an audition to get a public signup link you can post anywhere. Families pick a time slot; you run check-in, callbacks and casting from here."
        />
      ) : (
        <div className="space-y-4">
          {rows.map(({ audition: a, signups, firstSlot, lastSlot }) => {
            const url = `${base}/audition/${a.slug}`;
            const dates =
              firstSlot && lastSlot
                ? fmtDay(firstSlot, tz) === fmtDay(lastSlot, tz)
                  ? fmtDay(firstSlot, tz)
                  : `${fmtDay(firstSlot, tz)} – ${fmtDay(lastSlot, tz)}`
                : "No slots yet";
            return (
              <Card key={a.id} className="p-0">
                <List className="rounded-b-none border-0">
                  <ListRow
                    href={`/p/${productionId}/auditions/${a.id}/signups`}
                    title={a.title}
                    subtitle={`${dates} · ${signups} signed up`}
                    right={
                      <span className="flex items-center gap-2">
                        <Badge tone={a.isOpen ? "success" : "neutral"}>{a.isOpen ? "Open" : "Closed"}</Badge>
                        <ChevronRight className="size-4 text-muted" />
                      </span>
                    }
                  />
                </List>
                <div className="space-y-3 border-t border-line p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Public signup link</p>
                  <a href={url} target="_blank" className="block break-all font-display text-xl font-semibold text-accent sm:text-2xl">
                    {url.replace(/^https?:\/\//, "")}
                  </a>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton value={url} share />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <SectionTitle>New audition</SectionTitle>
      <details className="group rounded-2xl border border-line bg-surface" open={rows.length === 0}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 font-medium">
          <Plus className="size-4" /> Create an audition
        </summary>
        <div className="border-t border-line p-4">
          <AuditionForm action={createAudition} hidden={hidden} submitLabel="Create audition" />
        </div>
      </details>
    </div>
  );
}
