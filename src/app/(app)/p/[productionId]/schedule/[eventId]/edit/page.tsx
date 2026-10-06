import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { events } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { eventToInput, getEditorOptions, getEventBlocks } from "@/lib/schedule";
import { EventEditor } from "../../_components/event-editor";
import { StatusBadges } from "../../_components/bits";

export default async function EditEventPage({ params }: PageProps<"/p/[productionId]/schedule/[eventId]/edit">) {
  const { productionId, eventId } = await params;
  const { production, org } = await requireProductionEditor(productionId);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const ev = await db.query.events.findFirst({ where: and(eq(events.id, eventId), eq(events.productionId, productionId)) });
  if (!ev) notFound();
  const tz = org.timezone;
  const [blocks, options] = await Promise.all([
    getEventBlocks(ev.id),
    getEditorOptions(productionId, tz, production.defaultLocation, ev.startsAt),
  ]);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Edit event <StatusBadges event={ev} tz={tz} now={new Date()} showPublished />
          </span>
        }
        back={{ href: `/p/${productionId}/schedule/${ev.id}`, label: ev.title }}
      />
      <EventEditor productionId={productionId} options={options} initial={eventToInput(ev, blocks, tz)} status={ev.status} />
    </div>
  );
}
