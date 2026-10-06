import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { people, resources, roles, scenes } from "@/db/schema";
import { Card, EmptyState, Heading, PageHeader, SectionTitle } from "@/components/ui";
import { getCoveredPersonIds, requireProductionAccess } from "@/lib/access";
import { sceneLabel } from "@/lib/calls";
import { getMaterialsForPeople } from "@/lib/production-queries";
import { addResource } from "./actions";
import { ResourceForm } from "./resource-form";
import { ResourceList } from "./resource-list";

export default async function ResourcesPage({ params }: PageProps<"/p/[productionId]/resources">) {
  const { productionId } = await params;
  const { user, canEdit } = await requireProductionAccess(productionId);
  const base = `/p/${productionId}`;

  const [sceneRows, roleRows] = await Promise.all([
    db.select().from(scenes).where(eq(scenes.productionId, productionId)).orderBy(asc(scenes.act), asc(scenes.sortOrder)),
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
  ]);
  const sceneById = new Map(sceneRows.map((s) => [s.id, s]));
  const roleById = new Map(roleRows.map((r) => [r.id, r]));
  const where = (r: typeof resources.$inferSelect) => {
    const parts = [];
    if (r.roleId) parts.push(roleById.get(r.roleId)?.name);
    if (r.sceneId) {
      const s = sceneById.get(r.sceneId);
      if (s) parts.push(sceneLabel(s).split(":")[0]);
    }
    return parts.filter(Boolean).join(" · ") || null;
  };

  if (!canEdit) {
    const covered = await getCoveredPersonIds(user.id);
    const { general, byPerson } = await getMaterialsForPeople(productionId, covered);
    const ids = [...byPerson.keys()];
    const names = ids.length ? await db.select().from(people).where(inArray(people.id, ids)) : [];
    return (
      <div>
        <div className="mb-6">
          <Heading>Rehearsal materials</Heading>
          <p className="mt-1 text-base text-muted">Scripts, tracks and videos from the creative team.</p>
        </div>
        {names.map((p) => (
          <section key={p.id}>
            <SectionTitle>{p.userId === user.id ? "Your materials" : `${p.firstName}'s materials`}</SectionTitle>
            <ResourceList items={byPerson.get(p.id) ?? []} context={where} productionId={productionId} />
          </section>
        ))}
        {general.length ? (
          <section>
            <SectionTitle>For everyone</SectionTitle>
            <ResourceList items={general} productionId={productionId} />
          </section>
        ) : null}
        {!names.length && !general.length ? (
          <EmptyState title="No materials yet" body="When the creative team shares scripts, tracks or videos, they show up here." />
        ) : null}
      </div>
    );
  }

  const all = await db
    .select()
    .from(resources)
    .where(eq(resources.productionId, productionId))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));
  const general = all.filter((r) => !r.sceneId && !r.roleId);
  const byRole = all.filter((r) => r.roleId);
  const bySceneOnly = all.filter((r) => r.sceneId && !r.roleId);

  return (
    <div>
      <PageHeader as="h2"
        title="Resources"
        subtitle="Links to scripts, vocal tracks and choreo videos. Cast and families see the ones for their roles and scenes."
        back={{ href: base, label: "Overview" }}
      />
      {all.length === 0 ? (
        <EmptyState title="No links yet" body="Add a link for the whole show, a scene, or a single role. Nothing is uploaded; links only." />
      ) : null}
      {general.length ? (
        <>
          <SectionTitle>Whole show · {general.length}</SectionTitle>
          <ResourceList items={general} canEdit productionId={productionId} />
        </>
      ) : null}
      {bySceneOnly.length ? (
        <>
          <SectionTitle>By scene · {bySceneOnly.length}</SectionTitle>
          <ResourceList items={bySceneOnly} context={where} canEdit productionId={productionId} />
        </>
      ) : null}
      {byRole.length ? (
        <>
          <SectionTitle>By role · {byRole.length}</SectionTitle>
          <ResourceList items={byRole} context={where} canEdit productionId={productionId} />
        </>
      ) : null}

      <SectionTitle>Add a link</SectionTitle>
      <Card>
        <ResourceForm
          action={addResource.bind(null, productionId)}
          scenes={sceneRows.map((s) => ({ id: s.id, label: sceneLabel(s) }))}
          roles={roleRows.map((r) => ({ id: r.id, label: r.name }))}
        />
      </Card>
    </div>
  );
}
