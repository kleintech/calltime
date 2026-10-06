import { asc, eq, inArray } from "drizzle-orm";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { people, roleAssignments, roleGroupMembers, roleGroups, roles, sceneRoles } from "@/db/schema";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { personName } from "@/lib/production-queries";
import { IconSubmit } from "@/app/(app)/productions/_components/form";
import { ROLE_KINDS } from "@/app/(app)/productions/_components/constants";
import { createGroup, createRole, moveRole } from "./actions";
import { GroupForm, RoleForm } from "./forms";

export default async function RolesPage({ params }: PageProps<"/p/[productionId]/roles">) {
  const { productionId } = await params;
  await requireProductionEditor(productionId);
  const base = `/p/${productionId}`;

  const [roleRows, groupRows] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select().from(roleGroups).where(eq(roleGroups.productionId, productionId)).orderBy(asc(roleGroups.name)),
  ]);
  const roleIds = roleRows.map((r) => r.id);
  const [assigns, sceneLinks, members] = roleIds.length
    ? await Promise.all([
        db
          .select({ roleId: roleAssignments.roleId, kind: roleAssignments.kind, person: people })
          .from(roleAssignments)
          .innerJoin(people, eq(people.id, roleAssignments.personId))
          .where(inArray(roleAssignments.roleId, roleIds)),
        db.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds)),
        db.select().from(roleGroupMembers).where(inArray(roleGroupMembers.roleId, roleIds)),
      ])
    : [[], [], []];

  const sceneCount = new Map<string, number>();
  for (const l of sceneLinks) sceneCount.set(l.roleId, (sceneCount.get(l.roleId) ?? 0) + 1);
  const roleById = new Map(roleRows.map((r) => [r.id, r]));
  const roleOptions = roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));

  return (
    <div>
      {roleRows.length === 0 ? (
        <EmptyState title="No roles yet" body="Add every character and ensemble part. Leads first is a good habit." />
      ) : (
        ROLE_KINDS.map((k) => {
          const list = roleRows.filter((r) => r.kind === k.value);
          if (!list.length) return null;
          return (
            <section key={k.value}>
              <SectionTitle>
                {k.label} · {list.length}
              </SectionTitle>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {list.map((r, i) => {
                  const who = assigns
                    .filter((a) => a.roleId === r.id)
                    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "primary" ? -1 : 1));
                  const sc = sceneCount.get(r.id) ?? 0;
                  return (
                    <div key={r.id} className="flex items-stretch">
                      <Link href={`${base}/roles/${r.id}`} className="min-w-0 flex-1 px-4 py-3 hover:bg-surface-2">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{r.name}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {sc} scene{sc === 1 ? "" : "s"}
                          </span>
                          <ChevronRight className="ml-auto size-4 shrink-0 text-muted" />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {who.length ? (
                            who.map((a) => (
                              <Badge key={a.person.id} tone={a.kind === "primary" ? "neutral" : "gold"}>
                                {personName(a.person)}
                                {a.kind !== "primary" ? ` · ${a.kind}` : ""}
                              </Badge>
                            ))
                          ) : (
                            <Badge tone="warn">Not cast</Badge>
                          )}
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col justify-center border-l border-line">
                        <form action={moveRole.bind(null, productionId, r.id, "up")}>
                          <IconSubmit label="Move up" className={i === 0 ? "invisible" : ""}>
                            <ArrowUp className="size-4" />
                          </IconSubmit>
                        </form>
                        <form action={moveRole.bind(null, productionId, r.id, "down")}>
                          <IconSubmit label="Move down" className={i === list.length - 1 ? "invisible" : ""}>
                            <ArrowDown className="size-4" />
                          </IconSubmit>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <SectionTitle>Add a role</SectionTitle>
      <Card>
        <RoleForm action={createRole.bind(null, productionId)} submitLabel="Add role" resetOnSuccess />
      </Card>

      <SectionTitle>Role groups</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Bundle roles you often call together (“Pirates”, “Daughters”, “Dance ensemble”) so a rehearsal block can call the whole group.
      </p>
      {groupRows.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {groupRows.map((g) => {
            const rs = members
              .filter((m) => m.groupId === g.id)
              .map((m) => roleById.get(m.roleId))
              .filter((r) => !!r)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <Link
                key={g.id}
                href={`${base}/roles/groups/${g.id}`}
                className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full border border-line" style={{ background: g.color ?? "transparent" }} />
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted">
                    {rs.length} role{rs.length === 1 ? "" : "s"}
                  </span>
                  <ChevronRight className="ml-auto size-4 text-muted" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {rs.map((r) => (
                    <Badge key={r.id}>{r.name}</Badge>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
      <details className="group mt-3 rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-sm font-semibold text-accent">
          + New group
        </summary>
        <div className="border-t border-line p-4">
          <GroupForm action={createGroup.bind(null, productionId)} roles={roleOptions} submitLabel="Create group" resetOnSuccess />
        </div>
      </details>
    </div>
  );
}
