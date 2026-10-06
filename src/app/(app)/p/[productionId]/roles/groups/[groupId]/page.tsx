import { and, asc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { roleGroupMembers, roleGroups, roles } from "@/db/schema";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { isUuid } from "@/lib/production-queries";
import { ConfirmForm, SubmitButton } from "@/app/(app)/productions/_components/form";
import { deleteGroup, updateGroup } from "../../actions";
import { GroupForm } from "../../forms";

export default async function GroupPage({ params }: PageProps<"/p/[productionId]/roles/groups/[groupId]">) {
  const { productionId, groupId } = await params;
  await requireProductionEditor(productionId);
  if (!isUuid(groupId)) notFound();
  const group = await db.query.roleGroups.findFirst({
    where: and(eq(roleGroups.id, groupId), eq(roleGroups.productionId, productionId)),
  });
  if (!group) notFound();
  const [roleRows, members] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select().from(roleGroupMembers).where(eq(roleGroupMembers.groupId, groupId)),
  ]);

  return (
    <div>
      <PageHeader title={group.name} subtitle="Role group" back={{ href: `/p/${productionId}/roles`, label: "Roles" }} />
      <Card>
        <GroupForm
          key={group.id}
          action={updateGroup.bind(null, productionId, groupId)}
          group={group}
          roles={roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
          selected={members.map((m) => m.roleId)}
          submitLabel="Save group"
        />
      </Card>
      <SectionTitle>Remove</SectionTitle>
      <ConfirmForm
        action={deleteGroup.bind(null, productionId, groupId)}
        confirm={`Delete the group “${group.name}”? The roles themselves stay.`}
      >
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          <Trash2 className="size-4" /> Delete group
        </SubmitButton>
      </ConfirmForm>
    </div>
  );
}
