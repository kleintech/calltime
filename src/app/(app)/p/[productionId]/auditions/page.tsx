import { asc, desc, eq, sql } from "drizzle-orm";
import { ChevronRight, Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups, auditionSlots, auditions } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { Badge, Button, EmptyState, SectionTitle, Ticket as TicketCard } from "@/components/ui";
import { Sheet } from "@/components/sheet";
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

  const newAudition = (
    <Sheet
      trigger={
        <Button variant={rows.length === 0 ? "primary" : "soft"}>
          <Plus /> New audition
        </Button>
      }
      title="New audition"
      description="You'll add time slots next, then share the public link."
    >
      <AuditionForm action={createAudition} hidden={hidden} submitLabel="Create audition" />
    </Sheet>
  );

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Ticket />}
          title="No auditions yet"
          body="Create an audition to get a public signup link you can post anywhere. Families pick a time slot; you run check-in, callbacks and casting from here."
          action={newAudition}
        />
      ) : (
        <>
          <SectionTitle action={newAudition}>Auditions · {rows.length}</SectionTitle>
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
                <TicketCard
                  key={a.id}
                  stub={
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[.08em] text-muted">Public signup link</p>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-[15px] font-semibold text-accent hover:underline">
                          {url.replace(/^https?:\/\//, "")}
                        </a>
                      </div>
                      <CopyButton value={url} share />
                    </div>
                  }
                >
                  <Link href={`/p/${productionId}/auditions/${a.id}/signups`} className="-m-5 flex items-center gap-3 rounded-t-3xl p-5 transition-colors hover:bg-surface-2/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-xl font-semibold tracking-tight">{a.title}</p>
                        <Badge tone={a.isOpen ? "success" : "neutral"} dot>
                          {a.isOpen ? "Open" : "Closed"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[15px] text-muted">
                        {dates} · {signups} signed up
                      </p>
                    </div>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
                  </Link>
                </TicketCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
