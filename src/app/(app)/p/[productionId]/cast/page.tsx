import { asc, eq, inArray } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { creativeTeam, guardianships, people, roleAssignments, roles, users } from "@/db/schema";
import { Avatar, Badge, Card, EmptyState, LinkButton, List, ListRow, SectionTitle } from "@/components/ui";
import { requireProductionAccess } from "@/lib/access";
import { getAttendanceSummary } from "@/lib/schedule";
import { personName } from "@/lib/production-queries";
import { assignRole } from "./actions";
import { AssignForm } from "./forms";

export default async function CastPage({ params, searchParams }: PageProps<"/p/[productionId]/cast">) {
  const { productionId } = await params;
  const sp = await searchParams;
  const { canEdit, org } = await requireProductionAccess(productionId);
  const base = `/p/${productionId}`;

  const [roleRows, team] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db
      .select({ title: creativeTeam.title, name: users.name })
      .from(creativeTeam)
      .innerJoin(users, eq(users.id, creativeTeam.userId))
      .where(eq(creativeTeam.productionId, productionId))
      .orderBy(asc(creativeTeam.createdAt)),
  ]);
  const roleIds = roleRows.map((r) => r.id);
  const assigns = roleIds.length
    ? await db
        .select({ roleId: roleAssignments.roleId, kind: roleAssignments.kind, person: people })
        .from(roleAssignments)
        .innerJoin(people, eq(people.id, roleAssignments.personId))
        .where(inArray(roleAssignments.roleId, roleIds))
    : [];

  const roleOrder = new Map(roleRows.map((r, i) => [r.id, i]));
  const roleById = new Map(roleRows.map((r) => [r.id, r]));
  type Entry = { person: typeof people.$inferSelect; roles: { roleId: string; kind: string }[] };
  const byPerson = new Map<string, Entry>();
  for (const a of assigns) {
    const e = byPerson.get(a.person.id) ?? { person: a.person, roles: [] };
    e.roles.push({ roleId: a.roleId, kind: a.kind });
    byPerson.set(a.person.id, e);
  }
  const firstRole = (e: Entry) =>
    Math.min(...e.roles.map((r) => (roleOrder.get(r.roleId) ?? 999) + (r.kind === "primary" ? 0 : 1000)));
  const cast = [...byPerson.values()]
    .map((e) => ({ ...e, roles: e.roles.sort((a, b) => (roleOrder.get(a.roleId) ?? 0) - (roleOrder.get(b.roleId) ?? 0)) }))
    .sort((a, b) => firstRole(a) - firstRole(b) || personName(a.person).localeCompare(personName(b.person)));

  const teamSection = (
    <>
      <SectionTitle>Creative team</SectionTitle>
      {team.length ? (
        <List>
          {team.map((t, i) => (
            <ListRow key={i} title={t.name} subtitle={t.title} right={<Avatar name={t.name} />} />
          ))}
        </List>
      ) : (
        <p className="text-sm text-muted">No creative team yet.</p>
      )}
    </>
  );

  /* ─────────── Read-only view for cast & families ─────────── */
  if (!canEdit) {
    return (
      <div>
        <SectionTitle>Cast · {cast.length}</SectionTitle>
        {cast.length ? (
          <List>
            {cast.map((e) => (
              <ListRow
                key={e.person.id}
                title={personName(e.person)}
                subtitle={e.roles
                  .map((r) => `${roleById.get(r.roleId)?.name}${r.kind === "primary" ? "" : ` (${r.kind})`}`)
                  .join(", ")}
                right={<Avatar name={personName(e.person)} />}
              />
            ))}
          </List>
        ) : (
          <EmptyState title="Cast list coming soon" />
        )}
        {teamSection}
      </div>
    );
  }

  /* ─────────── Editor view ─────────── */
  const castIds = [...byPerson.keys()];
  const [guardianRows, orgPeople, attendanceByPerson] = await Promise.all([
    castIds.length
      ? db
          .select({ minorId: guardianships.minorId, guardian: people })
          .from(guardianships)
          .innerJoin(people, eq(people.id, guardianships.guardianId))
          .where(inArray(guardianships.minorId, castIds))
      : Promise.resolve([]),
    db
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, isMinor: people.isMinor })
      .from(people)
      .where(eq(people.orgId, org.id))
      .orderBy(asc(people.lastName), asc(people.firstName)),
    getAttendanceSummary(productionId),
  ]);
  const guardiansOf = new Map<string, (typeof people.$inferSelect)[]>();
  for (const g of guardianRows) guardiansOf.set(g.minorId, [...(guardiansOf.get(g.minorId) ?? []), g.guardian]);
  const castCount = new Map<string, number>();
  for (const a of assigns) castCount.set(a.roleId, (castCount.get(a.roleId) ?? 0) + 1);
  const uncast = roleRows.filter((r) => !castCount.get(r.id));
  const preRole = typeof sp.role === "string" && roleById.has(sp.role) ? sp.role : undefined;

  return (
    <div>
      {uncast.length ? (
        <div className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <span className="font-semibold">{uncast.length} not cast yet:</span>{" "}
          {uncast.map((r, i) => (
            <span key={r.id}>
              {i ? ", " : ""}
              <Link href={`${base}/cast?role=${r.id}#add`} className="underline underline-offset-2">
                {r.name}
              </Link>
            </span>
          ))}
        </div>
      ) : null}

      <SectionTitle>
        Cast · {cast.length} {cast.length === 1 ? "person" : "people"}
      </SectionTitle>
      {cast.length ? (
        <List>
          {cast.map((e) => {
            const gs = guardiansOf.get(e.person.id) ?? [];
            const hasAccess = !!e.person.userId || gs.some((g) => g.userId);
            return (
              <Link key={e.person.id} href={`${base}/cast/${e.person.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <Avatar name={personName(e.person)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{personName(e.person)}</span>
                    {e.person.isMinor ? <Badge>Minor</Badge> : null}
                    {hasAccess ? <Badge tone="success">On app</Badge> : <Badge tone="warn">Not invited</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.roles.map((r) => (
                      <Badge key={r.roleId} tone={r.kind === "primary" ? "accent" : "gold"}>
                        {roleById.get(r.roleId)?.name}
                        {r.kind !== "primary" ? ` · ${r.kind}` : ""}
                      </Badge>
                    ))}
                  </div>
                  {(() => {
                    const a = attendanceByPerson.get(e.person.id);
                    if (!a || (!a.absent && !a.late)) return null;
                    return (
                      <p className="mt-1 text-xs">
                        {a.absent ? <span className="font-medium text-danger">{a.absent} absent</span> : null}
                        {a.absent && a.late ? <span className="text-muted"> · </span> : null}
                        {a.late ? <span className="font-medium text-warn">{a.late} late</span> : null}
                        <span className="text-muted"> of {a.marked} marked</span>
                      </p>
                    );
                  })()}
                  {gs.length ? (
                    <p className="mt-1 truncate text-xs text-muted">Guardian: {gs.map((g) => personName(g)).join(", ")}</p>
                  ) : e.person.isMinor ? (
                    <p className="mt-1 text-xs text-warn">No guardian on file</p>
                  ) : null}
                </div>
                <ChevronRight className="mt-2 size-4 shrink-0 text-muted" />
              </Link>
            );
          })}
        </List>
      ) : (
        <EmptyState title="Nobody cast yet" body="Add people to roles below. Minors can be added with a parent or guardian."
          action={<LinkButton href={`${base}/import`} variant="secondary">Import a cast list</LinkButton>}
        />
      )}

      <div id="add" className="scroll-mt-4">
        <SectionTitle>Add to cast</SectionTitle>
        <Card>
          <AssignForm
            key={preRole ?? "none"}
            action={assignRole.bind(null, productionId)}
            defaultRoleId={preRole}
            roles={roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, castCount: castCount.get(r.id) ?? 0 }))}
            people={orgPeople.map((p) => ({ id: p.id, name: personName(p), isMinor: p.isMinor, inCast: byPerson.has(p.id) }))}
          />
        </Card>
      </div>

      {teamSection}
      <p className="mt-2 text-sm">
        <Link href={`${base}/team`} className="inline-flex min-h-11 items-center text-accent">
          Manage creative team →
        </Link>
      </p>
    </div>
  );
}
