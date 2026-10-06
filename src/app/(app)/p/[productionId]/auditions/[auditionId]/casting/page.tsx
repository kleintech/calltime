import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups, people, roleAssignments, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { fullName, getAuditionForProduction, getProductionAssignments } from "@/lib/auditions";
import { Badge, Card, EmptyState, Notice, SectionTitle } from "@/components/ui";
import { markRemainingNotCast } from "../../actions";
import { ConfirmButton } from "../../_components/forms";
import { BulkInvites, CastForm } from "../../_components/cast-form";
import { ConflictList, Stars, StatusBadge } from "../../_components/signup-bits";
import { kindLabel } from "@/app/(app)/productions/_components/constants";

const ORDER = { cast: 0, callback: 1, auditioned: 2, checked_in: 3, not_cast: 4 } as const;

export default async function CastingPage({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]/casting">) {
  const { productionId, auditionId } = await params;
  const { org, production } = await requireProductionEditor(productionId);
  await getAuditionForProduction(productionId, auditionId);

  const prodRoles = await db
    .select({ id: roles.id, name: roles.name, kind: roles.kind })
    .from(roles)
    .where(eq(roles.productionId, productionId))
    .orderBy(asc(roles.sortOrder), asc(roles.name));
  const castRows = await db
    .select({ roleId: roleAssignments.roleId, kind: roleAssignments.kind, firstName: people.firstName, lastName: people.lastName })
    .from(roleAssignments)
    .innerJoin(people, eq(people.id, roleAssignments.personId))
    .where(inArray(roleAssignments.roleId, prodRoles.length ? prodRoles.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]));
  const castByRole = new Map<string, typeof castRows>();
  for (const c of castRows) castByRole.set(c.roleId, [...(castByRole.get(c.roleId) ?? []), c]);

  const signups = (
    await db
      .select()
      .from(auditionSignups)
      .where(and(eq(auditionSignups.auditionId, auditionId), inArray(auditionSignups.status, ["cast", "callback", "auditioned", "checked_in", "not_cast"])))
      .orderBy(asc(auditionSignups.lastName))
  ).sort((a, b) => ORDER[a.status as keyof typeof ORDER] - ORDER[b.status as keyof typeof ORDER] || (b.rating ?? 0) - (a.rating ?? 0));
  const personIds = signups.map((s) => s.personId).filter((x): x is string => !!x);
  const assignments = await getProductionAssignments(productionId, personIds);
  const remaining = await db
    .select({ id: auditionSignups.id })
    .from(auditionSignups)
    .where(and(eq(auditionSignups.auditionId, auditionId), inArray(auditionSignups.status, ["registered", "checked_in", "auditioned", "callback"])));

  const roleOptions = prodRoles.map((r) => ({ id: r.id, name: r.name, taken: castByRole.get(r.id)?.length ?? 0 }));
  const castSignupIds = signups.filter((s) => s.status === "cast").map((s) => s.id);
  const ids = { productionId, auditionId };
  const base = `/p/${productionId}/auditions/${auditionId}`;

  if (prodRoles.length === 0) {
    return <EmptyState title="No roles yet" body="Add the production's roles first, then cast auditioners into them here." />;
  }

  return (
    <div className="space-y-6">
      <details className="rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 font-medium">
          Cast list so far
          <Badge tone={castByRole.size === prodRoles.length ? "success" : "neutral"}>
            {castByRole.size}/{prodRoles.length} roles filled
          </Badge>
        </summary>
        <ul className="divide-y divide-line border-t border-line">
          {prodRoles.map((r) => {
            const c = castByRole.get(r.id) ?? [];
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-right text-muted">
                  {c.length ? c.map((x) => `${x.firstName} ${x.lastName}${x.kind !== "primary" ? ` (${kindLabel(x.kind)})` : ""}`).join(", ") : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </details>

      {signups.length === 0 ? (
        <EmptyState title="Nobody to cast yet" body="Auditioners appear here once they're checked in, auditioned or called back." />
      ) : (
        <section>
          <SectionTitle>Candidates ({signups.length})</SectionTitle>
          <div className="space-y-3">
            {signups.map((s) => {
              const mine = assignments.filter((a) => a.personId === s.personId);
              return (
                <Card key={s.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`${base}/signups/${s.id}`} className="font-semibold hover:underline">
                        {fullName(s)}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                        {s.age != null ? <span>Age {s.age}</span> : null}
                        <Stars rating={s.rating} />
                      </div>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  {mine.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {mine.map((a) => (
                        <Badge key={a.roleId} tone="success">
                          {a.roleName}
                          {a.kind !== "primary" ? ` · ${kindLabel(a.kind)}` : ""}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {s.rolesInterested ? <p className="text-sm text-muted">Interested in: {s.rolesInterested}</p> : null}
                  <ConflictList compact conflicts={s.conflictDates} notes={s.conflictsText} tz={org.timezone} until={production.closingDate} />
                  {s.conflictDates.length && s.status !== "cast" ? (
                    <p className="text-xs text-muted">Casting adds these conflicts to the schedule automatically.</p>
                  ) : null}
                  <CastForm
                    ids={{ ...ids, signupId: s.id }}
                    roles={roleOptions}
                    preselect={s.status === "cast" ? [] : s.callbackRoleIds}
                    castLabel={s.status === "cast" ? "Add role" : `Cast ${s.firstName}`}
                    personName={fullName(s)}
                  />
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Invite the cast</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm text-muted">
            Creates sign-in links for guardians (and adult or teen performers with their own email) who don’t have an account yet. Links
            last 30 days.
          </p>
          <BulkInvites ids={ids} signupIds={castSignupIds} />
        </Card>
      </section>

      <section>
        <SectionTitle>Finalize &amp; share results</SectionTitle>
        <Card className="space-y-3">
          {remaining.length ? (
            <p className="text-sm">
              Families don&apos;t see <span className="font-semibold">Cast</span> or <span className="font-semibold">Not cast</span> on their
              signup page until you finalize. Finalizing marks the {remaining.length} auditioner{remaining.length === 1 ? "" : "s"} still
              registered, checked in, auditioned or on callback as Not cast.
            </p>
          ) : (
            <Notice tone="success">Cast list is final. Families can see their result on their signup page.</Notice>
          )}
          <form action={markRemainingNotCast}>
            <input type="hidden" name="productionId" value={productionId} />
            <input type="hidden" name="auditionId" value={auditionId} />
            <ConfirmButton
              variant="secondary"
              disabled={remaining.length === 0}
              message={`Finalize the cast list? ${remaining.length} remaining auditioner${remaining.length === 1 ? "" : "s"} will be marked Not cast, and every family will see their result on their signup page.`}
            >
              Finalize cast list
            </ConfirmButton>
          </form>
        </Card>
      </section>
    </div>
  );
}
