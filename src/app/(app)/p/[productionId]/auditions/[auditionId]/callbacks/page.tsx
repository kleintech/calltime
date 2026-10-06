import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { clashes, fullName, getAuditionForProduction, getSlotsWithCounts, type AuditionSignup } from "@/lib/auditions";
import { fmtDay, fmtDayLong, fmtRange } from "@/lib/time";
import { Badge, Card, EmptyState, LinkButton, SectionTitle, Select, buttonClass } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { saveCallback, setSignupStatus } from "../../actions";
import { PrintButton, StateForm, SubmitButton } from "../../_components/forms";
import { ConflictList, Stars, StatusBadge } from "../../_components/signup-bits";

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #callback-print, #callback-print * { visibility: visible !important; }
  #callback-print { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0 12mm; color: #000; }
}`;

export default async function CallbacksPage({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]/callbacks">) {
  const { productionId, auditionId } = await params;
  const { org, production } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const audition = await getAuditionForProduction(productionId, auditionId);
  const slots = await getSlotsWithCounts(auditionId);
  const cbSlots = slots.filter((s) => s.kind === "callback");
  const prodRoles = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.productionId, productionId))
    .orderBy(asc(roles.sortOrder), asc(roles.name));
  const roleName = new Map(prodRoles.map((r) => [r.id, r.name]));
  const cbSlotById = new Map(cbSlots.map((sl) => [sl.id, sl]));
  const all = await db
    .select()
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), inArray(auditionSignups.status, ["callback", "auditioned", "checked_in"])))
    .orderBy(asc(auditionSignups.lastName), asc(auditionSignups.firstName));
  const callbacks = all.filter((s) => s.status === "callback");
  const candidates = all.filter((s) => s.status !== "callback").sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const ids = { productionId, auditionId };
  const base = `/p/${productionId}/auditions/${auditionId}`;

  // Group by callback slot for the printable list + announcement.
  const groups: { key: string; title: string; people: AuditionSignup[] }[] = [];
  for (const sl of cbSlots) {
    const people = callbacks.filter((s) => s.callbackSlotId === sl.id);
    if (people.length)
      groups.push({
        key: sl.id,
        title: `${fmtDayLong(sl.startsAt, tz)}, ${fmtRange(sl.startsAt, sl.endsAt, tz)}${sl.label ? ` — ${sl.label}` : ""}`,
        people,
      });
  }
  const unscheduled = callbacks.filter((s) => !s.callbackSlotId || !cbSlots.some((sl) => sl.id === s.callbackSlotId));
  if (unscheduled.length) groups.push({ key: "none", title: "Time to be announced", people: unscheduled });

  const announcement = [
    `${production.title} — Callback list`,
    "",
    "Thank you to everyone who auditioned! The following people are invited to callbacks:",
    ...groups.flatMap((g) => ["", g.title, ...g.people.map((p) => `• ${fullName(p)}`)]),
    "",
    audition.location ? `Location: ${audition.location}` : "",
    "Not on the list? It doesn't mean you're not cast — callbacks just help us see specific pairings.",
    "Check your signup link for your callback time and the roles we'd like to see.",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>

      {cbSlots.length === 0 ? (
        <Card className="space-y-2 text-sm print:hidden">
          <p className="font-medium">No callback slots yet</p>
          <p className="text-muted">Add a slot with kind “Callback” so you can schedule people.</p>
          <LinkButton href={`${base}/slots`} variant="secondary">
            Add callback slots
          </LinkButton>
        </Card>
      ) : null}

      {candidates.length ? (
        <details className="rounded-2xl border border-line bg-surface print:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 font-medium">
            Add from auditions <Badge>{candidates.length}</Badge>
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {candidates.map((s) => (
              <form key={s.id} action={setSignupStatus} className="flex items-center gap-3 px-4 py-2">
                <input type="hidden" name="productionId" value={productionId} />
                <input type="hidden" name="auditionId" value={auditionId} />
                <input type="hidden" name="signupId" value={s.id} />
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/signups/${s.id}`} className="block truncate font-medium hover:underline">
                    {fullName(s)}
                  </Link>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <StatusBadge status={s.status} /> <Stars rating={s.rating} />
                  </div>
                </div>
                <button name="status" value="callback" className={buttonClass("secondary")}>
                  Callback
                </button>
              </form>
            ))}
          </div>
        </details>
      ) : null}

      {callbacks.length === 0 ? (
        <EmptyState title="No callbacks yet" body="Mark auditioners as “Callback” from their signup, or add them above." />
      ) : (
        <>
          <section className="print:hidden">
            <SectionTitle>Schedule callbacks ({callbacks.length})</SectionTitle>
            <div className="space-y-3">
              {callbacks.map((s) => (
                <Card key={s.id}>
                  <StateForm action={saveCallback} hidden={{ ...ids, signupId: s.id }} className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`${base}/signups/${s.id}`} className="font-semibold hover:underline">
                        {fullName(s)}
                      </Link>
                      <span className="flex items-center gap-2 text-sm text-muted">
                        <Stars rating={s.rating} />
                        {s.age != null ? `Age ${s.age}` : ""}
                      </span>
                    </div>
                    {s.rolesInterested ? <p className="text-sm text-muted">Interested in: {s.rolesInterested}</p> : null}
                    <ConflictList
                      compact
                      conflicts={s.conflictDates}
                      notes={s.conflictsText}
                      tz={tz}
                      until={production.closingDate}
                      against={cbSlots
                        .filter((sl) => sl.id === s.callbackSlotId)
                        .map((sl) => ({ label: "their callback", start: sl.startsAt, end: sl.endsAt }))}
                    />
                    <Select name="callbackSlotId" defaultValue={s.callbackSlotId ?? ""} aria-label="Callback slot">
                      <option value="">No callback time yet</option>
                      {cbSlots.map((sl) => (
                        <option key={sl.id} value={sl.id}>
                          {fmtDay(sl.startsAt, tz)} · {fmtRange(sl.startsAt, sl.endsAt, tz)}
                          {sl.label ? ` · ${sl.label}` : ""} ({sl.filled}/{sl.capacity})
                        </option>
                      ))}
                    </Select>
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">Read for</legend>
                      <div className="flex flex-wrap gap-2">
                        {prodRoles.map((r) => (
                          <label
                            key={r.id}
                            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
                          >
                            <input
                              type="checkbox"
                              name="roleIds"
                              value={r.id}
                              defaultChecked={s.callbackRoleIds.includes(r.id)}
                              className="sr-only"
                            />
                            {r.name}
                          </label>
                        ))}
                        {prodRoles.length === 0 ? <span className="text-sm text-muted">Add roles to the production first.</span> : null}
                      </div>
                    </fieldset>
                    <SubmitButton variant="secondary" className="w-full sm:w-auto">
                      Save callback
                    </SubmitButton>
                  </StateForm>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle
              action={
                <span className="print:hidden">
                  <PrintButton label="Print list" />
                </span>
              }
            >
              Callback list
            </SectionTitle>
            <div id="callback-print" className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="font-display text-xl font-semibold">{production.title}: Callbacks</h3>
              {audition.location ? <p className="text-sm text-muted">{audition.location}</p> : null}
              {groups.map((g) => (
                <div key={g.key} className="mt-4 break-inside-avoid">
                  <h4 className="border-b border-line pb-1 font-semibold">{g.title}</h4>
                  <ul className="mt-1 divide-y divide-line">
                    {g.people.map((p) => (
                      <li key={p.id} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-sm">
                        <span className="font-medium">
                          {fullName(p)}
                          {p.callbackSlotId &&
                          cbSlotById.get(p.callbackSlotId) &&
                          clashes(p.conflictDates, tz, cbSlotById.get(p.callbackSlotId)!.startsAt, cbSlotById.get(p.callbackSlotId)!.endsAt)
                            .length ? (
                            <span className="ml-1 text-danger">⚠ conflict</span>
                          ) : null}
                        </span>
                        <span className="text-muted">
                          {p.callbackRoleIds
                            .map((id) => roleName.get(id))
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="print:hidden">
            <SectionTitle action={<CopyButton value={announcement} label="Copy text" />}>Announcement</SectionTitle>
            <p className="mb-2 text-sm text-muted">Names and times only (no contact info), ready to post to families.</p>
            <pre className="whitespace-pre-wrap rounded-2xl border border-line bg-surface-2/60 p-4 font-sans text-sm">{announcement}</pre>
          </section>
        </>
      )}
    </div>
  );
}
