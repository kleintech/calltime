import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { getEditorOptions } from "@/lib/schedule";
import { EVENT_KINDS, type EventKind } from "@/lib/schedule-shared";
import { toDateInput, toTimeInput } from "@/lib/time";
import { EventEditor } from "../_components/event-editor";

export default async function NewEventPage({ params, searchParams }: PageProps<"/p/[productionId]/schedule/new">) {
  const { productionId } = await params;
  const sp = await searchParams;
  const { production, org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : toDateInput(new Date(), tz);
  const kind: EventKind = EVENT_KINDS.includes(sp.kind as EventKind) ? (sp.kind as EventKind) : "rehearsal";
  const options = await getEditorOptions(productionId, tz, production.defaultLocation);
  // Zero typing for the common case: start/end default to this production's most common times for
  // this kind of event (then the last one used, then 6–9 PM).
  const recent = await db
    .select({ startsAt: events.startsAt, endsAt: events.endsAt })
    .from(events)
    .where(and(eq(events.productionId, productionId), eq(events.kind, kind)))
    .orderBy(desc(events.startsAt))
    .limit(20);
  const mode = (xs: string[]) => {
    const n = new Map<string, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const usual = mode(recent.map((e) => `${toTimeInput(e.startsAt, tz)}|${toTimeInput(e.endsAt, tz)}`));
  const [start, end] = usual && usual.split("|")[0] < usual.split("|")[1] ? usual.split("|") : ["18:00", "21:00"];
  const kindTitle = { rehearsal: "Add rehearsal", performance: "Add performance", tech: "Add tech rehearsal", dress: "Add dress rehearsal", fitting: "Add fitting", meeting: "Add meeting" } as Record<string, string>;

  return (
    <div>
      <PageHeader as="h2" title={kindTitle[kind] ?? "New event"} back={{ href: `/p/${productionId}/schedule`, label: "Schedule" }} />
      <EventEditor
        productionId={productionId}
        options={options}
        status={null}
        initial={{
          kind,
          title: kind === "rehearsal" ? "Rehearsal" : "",
          date,
          start,
          end,
          location: production.defaultLocation ?? "",
          notes: "",
          blocks: [{ start, end, title: "", leader: "", location: "", notes: "", calls: [] }],
        }}
      />
    </div>
  );
}
