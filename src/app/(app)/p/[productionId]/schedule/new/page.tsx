import { PageHeader } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { getEditorOptions } from "@/lib/schedule";
import { EVENT_KINDS, type EventKind } from "@/lib/schedule-shared";
import { toDateInput } from "@/lib/time";
import { EventEditor } from "../_components/event-editor";

export default async function NewEventPage({ params, searchParams }: PageProps<"/p/[productionId]/schedule/new">) {
  const { productionId } = await params;
  const sp = await searchParams;
  const { production, org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : toDateInput(new Date(), tz);
  const kind: EventKind = EVENT_KINDS.includes(sp.kind as EventKind) ? (sp.kind as EventKind) : "rehearsal";
  const options = await getEditorOptions(productionId, tz, production.defaultLocation);

  return (
    <div>
      <PageHeader title="New event" back={{ href: `/p/${productionId}/schedule`, label: "Schedule" }} />
      <EventEditor
        productionId={productionId}
        options={options}
        status={null}
        initial={{
          kind,
          title: kind === "rehearsal" ? "Rehearsal" : "",
          date,
          start: "18:00",
          end: "21:00",
          location: production.defaultLocation ?? "",
          notes: "",
          blocks: [{ start: "18:00", end: "21:00", title: "", leader: "", location: "", notes: "", calls: [] }],
        }}
      />
    </div>
  );
}
