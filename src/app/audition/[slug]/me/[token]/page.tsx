import { and, eq, inArray } from "drizzle-orm";
import { CalendarPlus, CheckCircle2, MapPin, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { auditionSignups, auditionSlots, roles } from "@/db/schema";
import { fmtConflict, fullName, getOpenSlots, getPublicAudition, publicStatus, resultsAreFinal, seasonGuide } from "@/lib/auditions";
import { appBaseUrl } from "@/lib/invites";
import { fmtDay, fmtDayLong, fmtRange, toDateInput } from "@/lib/time";
import { Badge, Card, Notice, SectionTitle, buttonClass } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { ChangeSlotForm, ConflictsForm, WithdrawForm } from "./manage-forms";

export const metadata = { robots: { index: false } };

export default async function ManageSignupPage({ params, searchParams }: PageProps<"/audition/[slug]/me/[token]">) {
  const { slug, token } = await params;
  const sp = await searchParams;
  const row = await getPublicAudition(slug);
  if (!row) notFound();
  const { audition, org } = row;
  const tz = org.timezone;
  const signup = await db.query.auditionSignups.findFirst({
    where: and(eq(auditionSignups.manageToken, token), eq(auditionSignups.auditionId, audition.id)),
  });
  if (!signup) notFound();

  const slotIds = [signup.slotId, signup.callbackSlotId].filter((x): x is string => !!x);
  const slots = slotIds.length ? await db.select().from(auditionSlots).where(inArray(auditionSlots.id, slotIds)) : [];
  const slot = slots.find((s) => s.id === signup.slotId);
  const cbSlot = slots.find((s) => s.id === signup.callbackSlotId);
  const cbRoles = signup.callbackRoleIds.length
    ? (
        await db
          .select({ name: roles.name })
          .from(roles)
          .where(and(inArray(roles.id, signup.callbackRoleIds), eq(roles.productionId, audition.productionId)))
      ).map((r) => r.name)
    : [];
  const canChange = signup.status === "registered" && audition.isOpen;
  const options = canChange
    ? (await getOpenSlots(audition.id))
        .filter((s) => s.id !== signup.slotId)
        .map((s) => ({ id: s.id, label: `${fmtDay(s.startsAt, tz)} · ${fmtRange(s.startsAt, s.endsAt, tz)} (${s.remaining} left)` }))
    : [];
  const canWithdraw = ["registered", "checked_in", "auditioned", "callback"].includes(signup.status);
  const manageUrl = `${await appBaseUrl()}/audition/${slug}/me/${token}`;
  const icsHref = `/audition/${slug}/me/${token}/calendar.ics`;
  const isNew = sp.new === "1";
  const guide = seasonGuide(row.production.firstRehearsal, row.production.closingDate);
  const final = await resultsAreFinal(audition.id);
  const pub = publicStatus(signup.status, final);
  const place = slot?.location ?? audition.location;

  return (
    <div className="space-y-4">
      {isNew ? (
        <Card className="space-y-4 border-success/40 text-center">
          <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
          <div>
            <h2 className="font-display text-2xl font-semibold">{signup.firstName} is signed up</h2>
            {slot ? (
              <p className="mt-2 text-lg">
                <span className="font-semibold">{fmtDayLong(slot.startsAt, tz)}</span>
                <br />
                <span className="tabular-nums">{fmtRange(slot.startsAt, slot.endsAt, tz)}</span>
              </p>
            ) : null}
            {place ? (
              <a
                href={`https://maps.apple.com/?q=${encodeURIComponent(place)}`}
                className="mt-1 inline-flex items-center gap-1 text-base text-accent"
              >
                <MapPin className="size-4" aria-hidden /> {place}
              </a>
            ) : null}
          </div>
          {slot ? (
            <a href={icsHref} className={buttonClass("primary", "min-h-12 w-full text-base")}>
              <CalendarPlus className="size-5" aria-hidden /> Add to my calendar
            </a>
          ) : null}
          {audition.description ? (
            <div className="rounded-xl bg-surface-2/60 p-3 text-left">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted">What to bring &amp; prepare</p>
              <p className="mt-1 whitespace-pre-wrap text-base">{audition.description}</p>
            </div>
          ) : null}
          <div className="space-y-2 border-t border-line pt-4 text-left">
            <p className="text-base">
              <span className="font-semibold">Save this page.</span> It&apos;s your private link to check or change the time and see
              callback news. Share it only with family.
            </p>
            <CopyButton value={manageUrl} label="Copy my link" share />
          </div>
          {signup.guardianEmail && audition.isOpen ? (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-base">Signing up another child?</p>
              <Link href={`/audition/${slug}?from=${token}`} className={buttonClass("secondary", "w-full")}>
                <UserPlus className="size-4" aria-hidden /> Add another performer
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}

      {!isNew ? (
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-muted">{audition.title}</p>
              <h2 className="font-display text-2xl font-semibold leading-tight">{fullName(signup)}</h2>
            </div>
            <Badge tone={pub.tone}>{pub.label}</Badge>
          </div>
          {signup.status === "withdrawn" ? (
            <Notice>
              You&apos;ve withdrawn from this audition.{" "}
              {audition.isOpen ? (
                <Link href={`/audition/${slug}`} className="font-semibold underline">
                  Sign up again
                </Link>
              ) : null}
            </Notice>
          ) : slot ? (
            <div className="rounded-xl bg-accent-soft p-4">
              <p className="text-sm font-medium text-accent">Your audition</p>
              <p className="mt-1 font-display text-xl font-semibold">{fmtDayLong(slot.startsAt, tz)}</p>
              <p className="text-lg tabular-nums">{fmtRange(slot.startsAt, slot.endsAt, tz)}</p>
              {slot.location || audition.location ? (
                <a
                  href={`https://maps.apple.com/?q=${encodeURIComponent(place ?? "")}`}
                  className="mt-2 flex items-start gap-1.5 text-base text-accent underline-offset-2 hover:underline"
                >
                  <MapPin className="mt-1 size-4 shrink-0" aria-hidden /> {place}
                </a>
              ) : null}
              <a href={icsHref} className={buttonClass("secondary", "mt-3 w-full sm:w-auto")}>
                <CalendarPlus className="size-4" aria-hidden /> Add to my calendar
              </a>
            </div>
          ) : (
            <Notice tone="warn">
              No audition time yet. The production team will be in touch{options.length ? ", or pick one below" : ""}.
            </Notice>
          )}
        </Card>
      ) : null}

      {signup.status === "callback" ? (
        <Card className="space-y-2 border-gold/50 bg-gold-soft/40">
          <div className="flex items-center gap-2 text-gold">
            <Sparkles className="size-5" />
            <h2 className="font-display text-xl font-semibold">You&apos;ve got a callback!</h2>
          </div>
          {cbSlot ? (
            <>
              <p className="font-semibold">
                {fmtDayLong(cbSlot.startsAt, tz)} · {fmtRange(cbSlot.startsAt, cbSlot.endsAt, tz)}
              </p>
              {cbSlot.label ? <p className="text-sm">{cbSlot.label}</p> : null}
              {cbSlot.location || audition.location ? <p className="text-sm text-muted">{cbSlot.location ?? audition.location}</p> : null}
            </>
          ) : (
            <p className="text-sm">Callback time to be announced. Check back here.</p>
          )}
          {cbRoles.length ? (
            <p className="text-sm">
              We&apos;d like to see you read for: <span className="font-semibold">{cbRoles.join(", ")}</span>
            </p>
          ) : null}
          {cbSlot ? (
            <a href={icsHref} className={buttonClass("secondary", "w-full sm:w-auto")}>
              <CalendarPlus className="size-4" /> Add callback to calendar
            </a>
          ) : null}
        </Card>
      ) : null}

      {final && signup.status === "cast" ? (
        <Notice tone="success">Congratulations, {signup.firstName} has been cast! The production team will send next steps.</Notice>
      ) : null}
      {final && signup.status === "not_cast" ? (
        <Notice>
          Thank you for auditioning. We weren&apos;t able to offer {signup.firstName} a role in this production, and we hope to see you at
          the next one.
        </Notice>
      ) : null}

      {signup.status !== "withdrawn" ? (
        <section>
          <SectionTitle>Dates you can&apos;t make</SectionTitle>
          <Card className="space-y-3">
            {canWithdraw ? (
              <>
                <p className="text-base text-muted">
                  {guide ? `${guide}. ` : ""}Add or change these any time before casting.
                </p>
                <ConflictsForm
                  slug={slug}
                  token={token}
                  initial={signup.conflictDates}
                  notes={signup.conflictsText}
                  min={toDateInput(new Date(), tz)}
                  max={row.production.closingDate ?? undefined}
                />
              </>
            ) : signup.conflictDates.length ? (
              <>
                <ul className="space-y-1 text-base">
                  {signup.conflictDates.map((c, i) => (
                    <li key={i}>
                      {fmtConflict(c)}
                      {c.note ? <span className="text-muted"> · {c.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Need to change these? Tell the stage manager.</p>
              </>
            ) : (
              <p className="text-base text-muted">None listed. If something comes up, tell the stage manager.</p>
            )}
          </Card>
        </section>
      ) : null}

      {canChange && options.length ? (
        <section>
          <SectionTitle>Need a different time?</SectionTitle>
          <Card>
            <ChangeSlotForm slug={slug} token={token} options={options} />
          </Card>
        </section>
      ) : null}

      {canWithdraw ? (
        <section>
          <SectionTitle>Can&apos;t make it?</SectionTitle>
          <Card className="space-y-3">
            <p className="text-sm text-muted">Withdrawing frees your spot for someone else.</p>
            <WithdrawForm slug={slug} token={token} />
          </Card>
        </section>
      ) : null}

      {!isNew ? (
        <p className="text-center text-xs text-muted">
          <Link href={`/audition/${slug}`} className="underline">
            Audition details
          </Link>
        </p>
      ) : null}
    </div>
  );
}
