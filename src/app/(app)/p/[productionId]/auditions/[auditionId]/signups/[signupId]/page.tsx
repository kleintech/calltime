import { and, eq } from "drizzle-orm";
import { Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/db";
import { auditionSignups, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { fullName, getAuditionForProduction, getProductionAssignments, getSlotsWithCounts, isUuid } from "@/lib/auditions";
import { fmtDateTime, fmtDay, fmtRange } from "@/lib/time";
import { Avatar, BackLink, Badge, Card, Field, Select, SectionTitle, Textarea } from "@/components/ui";
import { moveSignup, saveReview } from "../../../actions";
import { StateForm, SubmitButton } from "../../../_components/forms";
import { ConflictList, RatingInput, StatusBadge, StatusButtons } from "../../../_components/signup-bits";

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function ContactLinks({ email, phone }: { email?: string | null; phone?: string | null }) {
  return (
    <span className="flex flex-col gap-1">
      {email ? (
        <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 text-accent hover:underline">
          <Mail className="size-3.5" /> {email}
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 text-accent hover:underline">
          <Phone className="size-3.5" /> {phone}
        </a>
      ) : null}
    </span>
  );
}

export default async function SignupDetail({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]/signups/[signupId]">) {
  const { productionId, auditionId, signupId } = await params;
  const { org, production } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const audition = await getAuditionForProduction(productionId, auditionId);
  if (!isUuid(signupId)) notFound();
  const s = await db.query.auditionSignups.findFirst({
    where: and(eq(auditionSignups.id, signupId), eq(auditionSignups.auditionId, auditionId)),
  });
  if (!s) notFound();
  const slots = await getSlotsWithCounts(auditionId);
  const slot = slots.find((x) => x.id === s.slotId);
  const cbSlot = slots.find((x) => x.id === s.callbackSlotId);
  const prodRoles = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.productionId, productionId));
  const cbRoles = prodRoles.filter((r) => s.callbackRoleIds.includes(r.id)).map((r) => r.name);
  const cast = s.personId ? await getProductionAssignments(productionId, [s.personId]) : [];
  const ids = { productionId, auditionId, signupId };
  const base = `/p/${productionId}/auditions/${auditionId}`;
  const auditionSlotsOnly = slots.filter((x) => x.kind === "audition");

  return (
    <div className="space-y-5">
      <BackLink href={`${base}/signups`} label="Signups" />
      <div className="flex items-center gap-3">
        <Avatar name={fullName(s)} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl font-semibold leading-tight">{fullName(s)}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {s.age != null ? <span>Age {s.age}</span> : null}
            <StatusBadge status={s.status} />
            {cast.map((c) => (
              <Badge key={c.roleId} tone="success">
                {c.roleName}
                {c.kind !== "primary" ? ` (${c.kind})` : ""}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted">Audition slot</span>
          <span className="font-medium">{slot ? `${fmtDay(slot.startsAt, tz)} · ${fmtRange(slot.startsAt, slot.endsAt, tz)}` : "None"}</span>
        </div>
        <StatusButtons ids={ids} status={s.status} />
      </Card>

      <section>
        <SectionTitle>Conflicts</SectionTitle>
        <Card>
          <ConflictList
            conflicts={s.conflictDates}
            notes={s.conflictsText}
            tz={tz}
            until={production.closingDate}
            against={[
              ...(slot ? [{ label: "their audition", start: slot.startsAt, end: slot.endsAt }] : []),
              ...(cbSlot ? [{ label: "their callback", start: cbSlot.startsAt, end: cbSlot.endsAt }] : []),
            ]}
          />
        </Card>
      </section>

      <section>
        <SectionTitle>Rating & notes</SectionTitle>
        <Card className="space-y-3">
          <RatingInput ids={ids} rating={s.rating} />
          <StateForm action={saveReview} hidden={ids} className="space-y-3">
            <Textarea name="staffNotes" defaultValue={s.staffNotes ?? ""} placeholder="Strong belt, great comic timing, needs dance work… (staff only)" rows={4} />
            <SubmitButton variant="secondary">Save notes</SubmitButton>
          </StateForm>
        </Card>
      </section>

      <section>
        <SectionTitle>Move to another slot</SectionTitle>
        <Card>
          <form action={moveSignup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="productionId" value={productionId} />
            <input type="hidden" name="auditionId" value={auditionId} />
            <input type="hidden" name="signupId" value={signupId} />
            <input type="hidden" name="kind" value="audition" />
            <Field label="Slot" className="flex-1">
              <Select name="slotId" defaultValue={s.slotId ?? ""}>
                <option value="">No slot</option>
                {auditionSlotsOnly.map((x) => (
                  <option key={x.id} value={x.id}>
                    {fmtDay(x.startsAt, tz)} · {fmtRange(x.startsAt, x.endsAt, tz)} ({x.filled}/{x.capacity}
                    {x.remaining === 0 && x.id !== s.slotId ? " full" : ""})
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="secondary">Move to this slot</SubmitButton>
          </form>
        </Card>
      </section>

      {s.status === "callback" || cbSlot || cbRoles.length ? (
        <section>
          <SectionTitle action={<Link href={`${base}/callbacks`} className="text-sm text-accent">Manage</Link>}>Callback</SectionTitle>
          <Card className="space-y-1 text-sm">
            <p>{cbSlot ? `${fmtDay(cbSlot.startsAt, tz)} · ${fmtRange(cbSlot.startsAt, cbSlot.endsAt, tz)}${cbSlot.label ? ` · ${cbSlot.label}` : ""}` : "No callback slot yet"}</p>
            {cbRoles.length ? <p className="text-muted">Reading for: {cbRoles.join(", ")}</p> : null}
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle>Details</SectionTitle>
        <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <Row label="Auditioner">
            <ContactLinks email={s.email} phone={s.phone} />
          </Row>
          {s.guardianName || s.guardianEmail || s.guardianPhone ? (
            <Row label="Guardian">
              <span className="flex flex-col gap-1">
                {s.guardianName ? <span>{s.guardianName}</span> : null}
                <ContactLinks email={s.guardianEmail} phone={s.guardianPhone} />
              </span>
            </Row>
          ) : null}
          <Row label="Interested in">{s.rolesInterested}</Row>
          <Row label="Experience">{s.experience}</Row>
          {audition.questions.map((q) => {
            const a = s.answers[q.id];
            return (
              <Row key={q.id} label={q.label}>
                {q.type === "checkbox" ? (a ? "Yes" : "No") : typeof a === "string" ? a : ""}
              </Row>
            );
          })}
          <Row label="Signed up">{fmtDateTime(s.createdAt, tz)}</Row>
        </dl>
      </section>
    </div>
  );
}
