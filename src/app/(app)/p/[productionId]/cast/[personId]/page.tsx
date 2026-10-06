import { and, asc, eq, inArray, isNull, gt, ne, or } from "drizzle-orm";
import { Mail, Phone, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { guardianships, invites, people, roleAssignments, roles } from "@/db/schema";
import { Avatar, Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { isUuid, personName } from "@/lib/production-queries";
import { ConfirmForm, IconSubmit } from "@/app/(app)/productions/_components/form";
import { addGuardian, addRoleToPerson, invitePerson, removeAssignment, removeGuardian, setAssignmentKind, updatePerson } from "../actions";
import { AddRoleForm, AssignmentKindSelect, GuardianForm, InviteForm, PersonForm } from "../forms";

export default async function PersonPage({ params }: PageProps<"/p/[productionId]/cast/[personId]">) {
  const { productionId, personId } = await params;
  const { org } = await requireProductionEditor(productionId);
  if (!isUuid(personId)) notFound();
  const person = await db.query.people.findFirst({ where: and(eq(people.id, personId), eq(people.orgId, org.id)) });
  if (!person) notFound();
  const base = `/p/${productionId}`;

  const [roleRows, mine, guardians, wards] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db
      .select({ roleId: roleAssignments.roleId, kind: roleAssignments.kind })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roles.productionId, productionId), eq(roleAssignments.personId, personId))),
    db
      .select({ relationship: guardianships.relationship, guardian: people })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.guardianId))
      .where(eq(guardianships.minorId, personId)),
    db
      .select({ minor: people })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.minorId))
      .where(eq(guardianships.guardianId, personId)),
  ]);

  // Only people in this production's cast (or their guardians) are managed here.
  const castIds = roleRows.length
    ? (
        await db
          .selectDistinct({ id: roleAssignments.personId })
          .from(roleAssignments)
          .where(inArray(roleAssignments.roleId, roleRows.map((r) => r.id)))
      ).map((r) => r.id)
    : [];
  const castWards = wards.filter((w) => castIds.includes(w.minor.id));
  if (!mine.length && !castWards.length) notFound();

  const pendingInvites = await db
    .select({ email: invites.email, personId: invites.personId, createdAt: invites.createdAt })
    .from(invites)
    .where(
      and(
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
        or(
          inArray(invites.personId, [personId, ...guardians.map((g) => g.guardian.id)]),
          eq(invites.guardianOfPersonId, personId),
        ),
      ),
    );
  const invitedIds = new Set(pendingInvites.map((i) => i.personId));

  const guardianCandidates = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
    .from(people)
    .where(and(eq(people.orgId, org.id), eq(people.isMinor, false), ne(people.id, personId)))
    .orderBy(asc(people.lastName), asc(people.firstName));
  const existingGuardianIds = new Set(guardians.map((g) => g.guardian.id));

  const roleById = new Map(roleRows.map((r) => [r.id, r]));
  const heldIds = new Set(mine.map((m) => m.roleId));
  const roleOpts = roleRows.filter((r) => !heldIds.has(r.id)).map((r) => ({ id: r.id, name: r.name, kind: r.kind, castCount: 1 }));
  const name = personName(person);

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/cast`, label: "Cast" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} className="size-11 text-sm" /> {name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-2">
            {person.isMinor ? <Badge>Minor</Badge> : null}
            {person.userId ? <Badge tone="success">Has the app</Badge> : null}
            {castWards.length ? <Badge tone="gold">Guardian of {castWards.map((w) => w.minor.firstName).join(", ")}</Badge> : null}
          </span>
        }
      />

      {mine.length ? (
        <>
          <SectionTitle>Roles in this show</SectionTitle>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {mine
              .sort((a, b) => (roleById.get(a.roleId)?.sortOrder ?? 0) - (roleById.get(b.roleId)?.sortOrder ?? 0))
              .map((m) => (
                <div key={m.roleId} className="flex items-center gap-2 px-4 py-2">
                  <Link href={`${base}/roles/${m.roleId}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                    {roleById.get(m.roleId)?.name}
                  </Link>
                  <AssignmentKindSelect action={setAssignmentKind.bind(null, productionId, m.roleId, personId)} value={m.kind} />
                  <ConfirmForm
                    action={removeAssignment.bind(null, productionId, m.roleId, personId)}
                    confirm={`Remove ${name} from ${roleById.get(m.roleId)?.name}?`}
                  >
                    <IconSubmit label="Remove from role">
                      <X className="size-4" />
                    </IconSubmit>
                  </ConfirmForm>
                </div>
              ))}
          </div>
          <Card className="mt-3">
            <AddRoleForm action={addRoleToPerson.bind(null, productionId, personId)} roles={roleOpts} />
          </Card>
        </>
      ) : null}

      <SectionTitle>App access</SectionTitle>
      <Card>
        {person.userId ? (
          <p className="text-sm text-muted">{name} signs in to Calltime and sees their own calls.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {person.isMinor
                ? `Older performers can have their own login. Guardians below see ${person.firstName}'s calls either way.`
                : `Invite ${person.firstName} to see their calls and subscribe to the rehearsal calendar.`}
              {invitedIds.has(personId) ? " An invite is already pending; a new link works too." : ""}
            </p>
            <InviteForm action={invitePerson.bind(null, productionId, personId)} email={person.email} label="Create invite link" />
          </div>
        )}
      </Card>

      {person.isMinor || guardians.length ? (
        <>
          <SectionTitle>Parents & guardians</SectionTitle>
          <div className="space-y-3">
            {guardians.map(({ guardian: g, relationship }) => (
              <Card key={g.id}>
                <div className="flex items-start gap-3">
                  <Avatar name={personName(g)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{personName(g)}</span>
                      <span className="text-xs text-muted">{relationship}</span>
                      {g.userId ? (
                        <Badge tone="success">Has the app</Badge>
                      ) : invitedIds.has(g.id) ? (
                        <Badge tone="gold">Invited</Badge>
                      ) : (
                        <Badge tone="warn">Not invited</Badge>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 text-sm text-muted">
                      {g.email ? (
                        <a href={`mailto:${g.email}`} className="flex items-center gap-1.5 hover:text-ink">
                          <Mail className="size-3.5" /> {g.email}
                        </a>
                      ) : null}
                      {g.phone ? (
                        <a href={`tel:${g.phone}`} className="flex items-center gap-1.5 hover:text-ink">
                          <Phone className="size-3.5" /> {g.phone}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <ConfirmForm
                    action={removeGuardian.bind(null, productionId, personId, g.id)}
                    confirm={`Remove ${personName(g)} as a guardian of ${name}? Their person record stays.`}
                  >
                    <IconSubmit label="Remove guardian">
                      <X className="size-4" />
                    </IconSubmit>
                  </ConfirmForm>
                </div>
                {!g.userId ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <InviteForm action={invitePerson.bind(null, productionId, g.id)} email={g.email} label="Invite to app" />
                  </div>
                ) : null}
              </Card>
            ))}
            <details className="rounded-2xl border border-line bg-surface" open={guardians.length === 0}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-sm font-semibold text-accent">
                + Add a parent or guardian
              </summary>
              <div className="border-t border-line p-4">
                <GuardianForm
                  action={addGuardian.bind(null, productionId, personId)}
                  candidates={guardianCandidates
                    .filter((c) => !existingGuardianIds.has(c.id))
                    .map((c) => ({ id: c.id, name: personName(c) }))}
                />
              </div>
            </details>
          </div>
        </>
      ) : null}

      <SectionTitle>Details</SectionTitle>
      <Card>
        <PersonForm key={person.id} action={updatePerson.bind(null, productionId, personId)} person={person} />
      </Card>
    </div>
  );
}
