import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { conflicts, organizations, people, productions, roleAssignments, roles } from "@/db/schema";
import { Card, EmptyState, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { getCoveredPersonIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { getCallsForPeople } from "@/lib/calls";
import { overlaps, personName } from "@/lib/schedule-shared";
import { fmtDay, fmtRange, toDateInput, toTimeInput } from "@/lib/time";
import { PersonChip } from "../../p/[productionId]/schedule/_components/bits";
import { ConflictForm, DeleteConflictButton } from "./conflict-form";

export default async function ConflictsPage({ searchParams }: PageProps<"/home/conflicts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string, re: RegExp) => (typeof sp[k] === "string" && re.test(sp[k]) ? sp[k] : undefined);
  const covered = await getCoveredPersonIds(user.id);
  const back = { href: "/home", label: "Calls" };

  if (covered.length === 0) {
    return (
      <div>
        <PageHeader title="Can't make it" back={back} />
        <EmptyState
          title="No one to report for"
          body="Absences are for performers and their guardians. Once your account is linked to a cast member, you can tell the team when they can't make it."
          action={<LinkButton href="/home" variant="secondary">Back to Calls</LinkButton>}
        />
      </div>
    );
  }

  const now = new Date();
  const personRows = await db
    .select({ p: people, tz: organizations.timezone })
    .from(people)
    .innerJoin(organizations, eq(organizations.id, people.orgId))
    .where(inArray(people.id, covered));
  personRows.sort((a, b) => a.p.firstName.localeCompare(b.p.firstName));
  const tzOf = new Map(personRows.map((r) => [r.p.id, r.tz]));
  const nameOf = new Map(personRows.map((r) => [r.p.id, r.p.firstName]));

  const castIn = await db
    .selectDistinct({ personId: roleAssignments.personId, id: productions.id, title: productions.title })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(productions, eq(productions.id, roles.productionId))
    .where(and(inArray(roleAssignments.personId, covered)));
  const prodTitle = new Map(castIn.map((c) => [c.id, c.title]));

  const rows = await db
    .select()
    .from(conflicts)
    .where(and(inArray(conflicts.personId, covered), gte(conflicts.endsAt, now)))
    .orderBy(asc(conflicts.startsAt));

  // Flag conflicts that overlap a published call, so families know to tell the team
  const calls = rows.length ? await getCallsForPeople(covered, { from: now }) : [];

  const tz0 = personRows[0]?.tz ?? "America/New_York";
  const allPersons = personRows.map((r) => ({
    id: r.p.id,
    name: personName(r.p),
    productions: castIn.filter((c) => c.personId === r.p.id).map((c) => ({ id: c.id, title: c.title })),
  }));
  // A guardian's own person record isn't cast; offer only people who are (unless nobody is yet).
  const castPersons = allPersons.filter((p) => p.productions.length > 0);
  const persons = castPersons.length ? castPersons : allPersons;

  return (
    <div>
      <PageHeader
        title="Can't make it"
        subtitle="Tell the creative team when you can't be there. They see it while building the schedule."
        back={back}
      />
      <div className="grid gap-6 md:grid-cols-[1fr_1fr] md:items-start">
        <section>
          <SectionTitle>Upcoming</SectionTitle>
          {rows.length === 0 ? (
            <EmptyState title="Nothing reported" body="If something comes up, add it here so the team can plan around it." />
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => {
                const tz = tzOf.get(c.personId) ?? tz0;
                const allDay = toTimeInput(c.startsAt, tz) === "00:00" && toTimeInput(c.endsAt, tz) === "00:00";
                const lastDay = new Date(c.endsAt.getTime() - 1);
                const multiDay = toDateInput(c.startsAt, tz) !== toDateInput(lastDay, tz);
                const when = allDay
                  ? multiDay
                    ? `${fmtDay(c.startsAt, tz)} – ${fmtDay(lastDay, tz)} · All day`
                    : `${fmtDay(c.startsAt, tz)} · All day`
                  : `${fmtDay(c.startsAt, tz)} · ${fmtRange(c.startsAt, c.endsAt, tz)}`;
                const clashes = calls.filter(
                  (k) => k.person.id === c.personId && k.event.status !== "cancelled" && overlaps(k.callAt, k.releaseAt, c.startsAt, c.endsAt),
                );
                return (
                  <li key={c.id}>
                    <Card className="flex items-start gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        {persons.length > 1 ? <PersonChip name={nameOf.get(c.personId) ?? "?"} className="mb-1" /> : null}
                        <p className="font-semibold">{when}</p>
                        <p className="text-sm text-muted">
                          {c.productionId ? prodTitle.get(c.productionId) ?? "One show" : "All shows"}
                          {c.note ? ` · ${c.note}` : ""}
                        </p>
                        {clashes.map((k) => (
                          <p key={k.event.id} className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-warn-soft px-2 py-1 text-xs text-warn">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                            Overlaps a call: {fmtDay(k.callAt, tz)} · {k.event.title} {fmtRange(k.callAt, k.releaseAt, tz)}
                          </p>
                        ))}
                      </div>
                      <DeleteConflictButton id={c.id} />
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <SectionTitle>Add an absence</SectionTitle>
          <Card>
            <ConflictForm
              persons={persons}
              today={toDateInput(now, tz0)}
              prefill={{
                personId: persons.some((p) => p.id === sp.person) ? (sp.person as string) : undefined,
                date: str("date", /^\d{4}-\d{2}-\d{2}$/),
                start: str("start", /^\d{2}:\d{2}$/),
                end: str("end", /^\d{2}:\d{2}$/),
              }}
            />
          </Card>
        </section>
      </div>
    </div>
  );
}
