import { and, asc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { people, resources, roleAssignments, roles, sceneRoles, scenes } from "@/db/schema";
import { addResource } from "../../resources/actions";
import { ResourceForm } from "../../resources/resource-form";
import { ResourceList } from "../../resources/resource-list";
import { Badge, Card, EmptyState, List, ListRow, PageHeader, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { sceneLabel } from "@/lib/calls";
import { isUuid, personName } from "@/lib/production-queries";
import { ConfirmForm, SubmitButton } from "@/app/(app)/productions/_components/form";
import { ROLE_KIND_SINGULAR, kindLabel } from "@/app/(app)/productions/_components/constants";
import { deleteRole, updateRole } from "../actions";
import { RoleForm } from "../forms";

export default async function RolePage({ params }: PageProps<"/p/[productionId]/roles/[roleId]">) {
  const { productionId, roleId } = await params;
  await requireProductionEditor(productionId);
  if (!isUuid(roleId)) notFound();
  const role = await db.query.roles.findFirst({ where: and(eq(roles.id, roleId), eq(roles.productionId, productionId)) });
  if (!role) notFound();
  const base = `/p/${productionId}`;

  const [cast, sceneRows, roleResources] = await Promise.all([
    db
      .select({ kind: roleAssignments.kind, person: people })
      .from(roleAssignments)
      .innerJoin(people, eq(people.id, roleAssignments.personId))
      .where(eq(roleAssignments.roleId, roleId))
      .orderBy(asc(people.lastName), asc(people.firstName)),
    db
      .select({ scene: scenes })
      .from(sceneRoles)
      .innerJoin(scenes, eq(scenes.id, sceneRoles.sceneId))
      .where(eq(sceneRoles.roleId, roleId))
      .orderBy(asc(scenes.act), asc(scenes.sortOrder)),
    db
      .select()
      .from(resources)
      .where(and(eq(resources.productionId, productionId), eq(resources.roleId, roleId)))
      .orderBy(asc(resources.sortOrder), asc(resources.createdAt)),
  ]);

  return (
    <div>
      <PageHeader as="h2" title={role.name} subtitle={ROLE_KIND_SINGULAR[role.kind]} back={{ href: `${base}/roles`, label: "Roles" }} />
      <Card>
        <RoleForm key={role.id} action={updateRole.bind(null, productionId, roleId)} role={role} submitLabel="Save role" />
      </Card>

      <SectionTitle>Cast</SectionTitle>
      {cast.length ? (
        <List>
          {cast.map(({ person, kind }) => (
            <ListRow
              key={person.id}
              href={`${base}/cast/${person.id}`}
              title={personName(person)}
              right={<Badge tone={kind === "primary" ? "neutral" : "gold"}>{kindLabel(kind)}</Badge>}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="Not cast yet" body="Assign someone from the Cast tab." />
      )}

      <SectionTitle>Scenes · {sceneRows.length}</SectionTitle>
      {sceneRows.length ? (
        <List>
          {sceneRows.map(({ scene }) => (
            <ListRow key={scene.id} href={`${base}/scenes/${scene.id}`} title={sceneLabel(scene)} />
          ))}
        </List>
      ) : (
        <p className="text-sm text-muted">Not in any scene yet. Use the Breakdown tab or edit a scene.</p>
      )}

      <SectionTitle>Links for this role</SectionTitle>
      {roleResources.length ? (
        <ResourceList items={roleResources} canEdit productionId={productionId} />
      ) : (
        <p className="text-sm text-muted">Vocal tracks, sides, choreo videos. Only people cast in {role.name} see them.</p>
      )}
      <Card className="mt-3">
        <ResourceForm action={addResource.bind(null, productionId)} fixed={{ roleId }} />
      </Card>

      <SectionTitle>Remove</SectionTitle>
      <ConfirmForm
        action={deleteRole.bind(null, productionId, roleId)}
        confirm={`Delete “${role.name}”? Its cast assignments and scene breakdown entries will be removed too.`}
      >
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          <Trash2 className="size-4" /> Delete role
        </SubmitButton>
      </ConfirmForm>
    </div>
  );
}
