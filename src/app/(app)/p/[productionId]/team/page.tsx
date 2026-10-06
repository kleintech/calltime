import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { UserPlus, UsersRound, X } from "lucide-react";
import { db } from "@/db";
import { creativeTeam, invites, users } from "@/db/schema";
import { Avatar, Badge, Button, Card, EmptyState, SectionTitle } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { CopyButton } from "@/components/copy-button";
import { requireProductionEditor } from "@/lib/access";
import { inviteUrl } from "@/lib/invites";
import { ConfirmForm, IconSubmit } from "@/app/(app)/productions/_components/form";
import { addTeamMember, removeTeamMember, revokeTeamInvite, updateTeamMember } from "./actions";
import { AddMemberForm, EditMemberForm } from "./forms";

export default async function TeamPage({ params }: PageProps<"/p/[productionId]/team">) {
  const { productionId } = await params;
  const { user } = await requireProductionEditor(productionId);

  const [team, pending] = await Promise.all([
    db
      .select({ member: creativeTeam, user: { id: users.id, name: users.name, email: users.email } })
      .from(creativeTeam)
      .innerJoin(users, eq(users.id, creativeTeam.userId))
      .where(eq(creativeTeam.productionId, productionId))
      .orderBy(asc(creativeTeam.createdAt)),
    db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.productionId, productionId),
          isNotNull(invites.creativeTitle),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(invites.createdAt)),
  ]);
  const pendingWithUrls = await Promise.all(pending.map(async (i) => ({ ...i, url: await inviteUrl(i.token) })));

  const addSomeone = (
    <Sheet
      trigger={
        <Button variant={team.length ? "soft" : "primary"} size={team.length ? "sm" : "md"}>
          <UserPlus /> Add someone
        </Button>
      }
      title="Add to the creative team"
      description="If they already use Calltime they're added right away. Otherwise you'll get an invite link to send them."
    >
      <AddMemberForm action={addTeamMember.bind(null, productionId)} />
    </Sheet>
  );

  return (
    <div>
      <SectionTitle action={team.length ? addSomeone : null}>Creative team · {team.length}</SectionTitle>
      {team.length ? (
        <div className="space-y-2">
          {team.map(({ member, user: u }) => (
            <details key={u.id} className="group rounded-2xl border border-line bg-surface">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    {u.id === user.id ? <span className="text-xs text-muted">(you)</span> : null}
                  </div>
                  <div className="truncate text-sm text-muted">{u.email}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone="gold">{member.title}</Badge>
                  {!member.canEdit ? <Badge>View only</Badge> : null}
                </div>
              </summary>
              <div className="space-y-4 border-t border-line p-4">
                <EditMemberForm
                  action={updateTeamMember.bind(null, productionId, u.id)}
                  title={member.title}
                  canEdit={member.canEdit}
                />
                <ConfirmForm
                  action={removeTeamMember.bind(null, productionId, u.id)}
                  confirm={
                    u.id === user.id
                      ? "Remove yourself from this creative team? You may lose access to this production."
                      : `Remove ${u.name} from the creative team?`
                  }
                >
                  <button type="submit" className="text-sm font-medium text-danger hover:underline">
                    Remove from team
                  </button>
                </ConfirmForm>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<UsersRound />}
          title="No creative team yet"
          body="Add the director, music director, choreographer and stage manager."
          action={addSomeone}
        />
      )}

      {pendingWithUrls.length ? (
        <>
          <SectionTitle>Pending invites</SectionTitle>
          <div className="space-y-2">
            {pendingWithUrls.map((i) => (
              <Card key={i.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.name || i.email}</p>
                    <p className="truncate text-sm text-muted">
                      {i.name ? `${i.email} · ` : ""}
                      {i.creativeTitle}
                    </p>
                  </div>
                  <ConfirmForm action={revokeTeamInvite.bind(null, productionId, i.id)} confirm={`Revoke the invite for ${i.email}?`}>
                    <IconSubmit label="Revoke invite">
                      <X className="size-4" />
                    </IconSubmit>
                  </ConfirmForm>
                </div>
                <CopyButton value={i.url} share />
              </Card>
            ))}
          </div>
        </>
      ) : null}

    </div>
  );
}
