import { and, asc, eq } from "drizzle-orm";
import { CalendarDays, ChevronDown, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { auditionSignups, roles } from "@/db/schema";
import { getPublicAudition, getSlotsWithCounts, seasonGuide } from "@/lib/auditions";
import { fmtDay, fmtDayLong, toDateInput } from "@/lib/time";
import { Card, Notice } from "@/components/ui";
import { SignupForm, type GuardianPrefill } from "./signup-form";
import { publicSlotOptions } from "./slot-options";

export default async function PublicAuditionPage({ params, searchParams }: PageProps<"/audition/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const row = await getPublicAudition(slug);
  if (!row) notFound();
  const { audition, production, org } = row;
  const tz = org.timezone;
  const allSlots = (await getSlotsWithCounts(audition.id)).filter((s) => s.kind === "audition");
  const options = audition.isOpen ? await publicSlotOptions(audition.id, tz) : [];
  const prodRoles = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.productionId, production.id))
    .orderBy(asc(roles.sortOrder), asc(roles.name));

  // "Signing up another child?" — prefill guardian details from the sibling's signup (same audition, via its private token).
  let prefill: GuardianPrefill | undefined;
  if (typeof sp.from === "string" && sp.from) {
    const sib = await db.query.auditionSignups.findFirst({
      where: and(eq(auditionSignups.manageToken, sp.from), eq(auditionSignups.auditionId, audition.id)),
    });
    if (sib?.guardianEmail) {
      prefill = {
        lastName: sib.lastName,
        guardianName: sib.guardianName ?? "",
        guardianEmail: sib.guardianEmail,
        guardianPhone: sib.guardianPhone ?? "",
      };
    }
  }

  const first = allSlots[0];
  const last = allSlots[allSlots.length - 1];
  const dates = first
    ? fmtDay(first.startsAt, tz) === fmtDay(last.startsAt, tz)
      ? fmtDayLong(first.startsAt, tz)
      : `${fmtDay(first.startsAt, tz)} – ${fmtDay(last.startsAt, tz)}`
    : null;
  const conflictGuide = seasonGuide(production.firstRehearsal, production.closingDate);
  const longDescription = (audition.description?.length ?? 0) > 180;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-display text-2xl font-semibold leading-tight">{audition.title}</h2>
        <div className="space-y-1.5 text-base">
          {dates ? (
            <p className="flex items-start gap-2">
              <CalendarDays className="mt-1 size-4 shrink-0 text-accent" aria-hidden /> {dates}
            </p>
          ) : null}
          {audition.location ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-1 size-4 shrink-0 text-accent" aria-hidden /> {audition.location}
            </p>
          ) : null}
        </div>
        {audition.description ? (
          longDescription ? (
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span className="block text-sm font-semibold uppercase tracking-wider text-muted">What to prepare</span>
                <span className="mt-1 line-clamp-3 whitespace-pre-wrap text-base leading-relaxed group-open:line-clamp-none">
                  {audition.description}
                </span>
                <span className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
                  <span className="group-open:hidden">More</span>
                  <span className="hidden group-open:inline">Less</span>
                  <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
                </span>
              </summary>
            </details>
          ) : (
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-muted">What to prepare</p>
              <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{audition.description}</p>
            </div>
          )
        ) : null}
      </Card>

      {!audition.isOpen ? (
        <Notice tone="warn">
          <p className="font-semibold">Signups for {production.title} are closed</p>
          <p className="mt-1">
            Questions? Contact {org.name}. Already signed up? Open the private link from your confirmation page to see your time.
          </p>
        </Notice>
      ) : (
        <>
          {prefill ? (
            <Notice tone="success">Signing up another performer — we kept the parent/guardian details from your last signup.</Notice>
          ) : null}
          <SignupForm
            slug={slug}
            roles={prodRoles}
            questions={audition.questions}
            slots={options}
            prefill={prefill}
            conflictGuide={conflictGuide}
            conflictMin={toDateInput(new Date(), tz)}
            conflictMax={production.closingDate ?? undefined}
          />
        </>
      )}
    </div>
  );
}
