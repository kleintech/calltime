import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { roleAssignments, roles, sceneRoles, scenes } from "@/db/schema";
import { EmptyState, LinkButton } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { daysSince, getRehearsalStats } from "@/lib/production-queries";
import { BreakdownMatrix } from "./matrix";

export default async function BreakdownPage({ params }: PageProps<"/p/[productionId]/breakdown">) {
  const { productionId } = await params;
  await requireProductionEditor(productionId);
  const base = `/p/${productionId}`;

  const [sceneRows, roleRows] = await Promise.all([
    db.select().from(scenes).where(eq(scenes.productionId, productionId)).orderBy(asc(scenes.act), asc(scenes.sortOrder), asc(scenes.createdAt)),
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
  ]);
  if (!sceneRows.length || !roleRows.length) {
    return (
      <EmptyState
        title="Nothing to break down yet"
        body={`The breakdown needs ${!roleRows.length ? "roles" : ""}${!roleRows.length && !sceneRows.length ? " and " : ""}${!sceneRows.length ? "scenes" : ""}. Add them first.`}
        action={
          <LinkButton href={`${base}/${!roleRows.length ? "roles" : "scenes"}`}>{!roleRows.length ? "Add roles" : "Add scenes"}</LinkButton>
        }
      />
    );
  }
  const roleIds = roleRows.map((r) => r.id);
  const [links, assigns] = await Promise.all([
    db.select().from(sceneRoles).where(inArray(sceneRoles.roleId, roleIds)),
    db.select({ roleId: roleAssignments.roleId }).from(roleAssignments).where(inArray(roleAssignments.roleId, roleIds)),
  ]);
  const stats = await getRehearsalStats(productionId);
  const rehearsed = Object.fromEntries(
    [...stats.scenes].map(([id, st]) => [id, { count: st.count, daysAgo: st.last ? daysSince(st.last) : null }]),
  );
  const castCount = new Map<string, number>();
  for (const a of assigns) castCount.set(a.roleId, (castCount.get(a.roleId) ?? 0) + 1);

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Who&apos;s in each scene. This decides who gets called when you schedule a scene.
      </p>
      <BreakdownMatrix
      productionId={productionId}
      scenes={sceneRows.map((s) => ({ id: s.id, act: s.act, number: s.number, name: s.name }))}
      roles={roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, castCount: castCount.get(r.id) ?? 0 }))}
      initial={links.map((l) => `${l.sceneId}:${l.roleId}`)}
      rehearsed={stats.started ? rehearsed : undefined}
      />
    </div>
  );
}
