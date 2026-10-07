import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creativeTeam, orgMembers, productions, users } from "@/db/schema";
import { Avatar, Badge, Card, Field, Input, List, PageHeader, SectionTitle, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "../_components/action-form";
import { Disclosure } from "../_components/disclosure";
import { OrgChrome } from "../_components/org-chrome";
import { PendingInvites } from "../_components/pending-invites";
import { getPendingInvites, resolveAdminOrg } from "../_lib/org";
import { inviteMember, issuePasswordResetLink, removeMember, setMemberRole } from "./actions";

export const metadata = { title: "Members" };

export default async function MembersPage({ searchParams }: PageProps<"/org/members">) {
  const sp = await searchParams;
  const { user: me, org, orgs } = await resolveAdminOrg(sp.org);

  const members = await db
    .select({ user: users, role: orgMembers.role, joined: orgMembers.createdAt })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, org.id))
    .orderBy(users.name);

  const ids = members.map((m) => m.user.id);
  const titles = ids.length
    ? await db
        .select({ userId: creativeTeam.userId, title: creativeTeam.title, production: productions.title })
        .from(creativeTeam)
        .innerJoin(productions, eq(productions.id, creativeTeam.productionId))
        .where(and(eq(productions.orgId, org.id), inArray(creativeTeam.userId, ids)))
    : [];
  const titlesByUser = new Map<string, string[]>();
  for (const t of titles) titlesByUser.set(t.userId, [...(titlesByUser.get(t.userId) ?? []), `${t.title} · ${t.production}`]);

  const adminCount = members.filter((m) => m.role === "admin").length;
  const pending = await getPendingInvites(org.id);

  return (
    <div>
      <PageHeader title="Members" subtitle={`Everyone with an account at ${org.name}.`} />
      <OrgChrome org={org} orgs={orgs} active="members" path="/org/members" />

      <Card>
        <h2 className="mb-1 font-semibold">Invite someone</h2>
        <p className="mb-4 text-sm text-muted">
          You&apos;ll get a link to send them. For a performer or parent, invite them from their page under{" "}
          <span className="font-medium text-ink">People</span> so their account is linked to the right kids.
        </p>
        <ActionForm action={inviteMember} submitLabel="Get invite link" resetOnSuccess pendingLabel="Creating…">
          <input type="hidden" name="orgId" value={org.id} />
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="off" placeholder="name@example.com" />
          </Field>
          <Field label="Name (optional)" hint="Pre-fills their account.">
            <Input name="name" autoComplete="off" />
          </Field>
          <Field label="Role" hint="Admins can create productions, manage people, members and API keys.">
            <Select name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </ActionForm>
      </Card>

      {pending.length ? (
        <>
          <SectionTitle>Pending invites · {pending.length}</SectionTitle>
          <PendingInvites orgId={org.id} timezone={org.timezone} items={pending} />
        </>
      ) : null}

      <SectionTitle>Members · {members.length}</SectionTitle>
      <List>
        {members.map((m) => {
          const isLastAdmin = m.role === "admin" && adminCount <= 1;
          const roles = titlesByUser.get(m.user.id) ?? [];
          const firstName = m.user.name.trim().split(/\s+/)[0] || m.user.name;
          return (
            <div key={m.user.id} className="px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={m.user.name} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{m.user.name}</span>
                      {m.role === "admin" ? <Badge tone="accent">Admin</Badge> : null}
                      {m.user.id === me.id ? <Badge>You</Badge> : null}
                    </div>
                    <div className="truncate text-sm text-muted">{m.user.email}</div>
                    {roles.length ? <div className="mt-0.5 text-xs text-muted">{roles.join(" · ")}</div> : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 pl-12 sm:pl-0">
                  {!isLastAdmin ? (
                    <form action={setMemberRole}>
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                      <SubmitButton
                        confirm={
                          m.role === "admin"
                            ? m.user.id === me.id
                              ? "Remove your own admin access? You keep your account but can no longer manage people, invites or productions."
                              : `Remove admin access for ${m.user.name}? They keep their account but can no longer manage people, invites or productions.`
                            : `Make ${m.user.name} an admin? They can manage everyone in ${org.name}, every production, invites and API keys.`
                        }
                      >
                        {m.role === "admin" ? "Make member" : "Make admin"}
                      </SubmitButton>
                    </form>
                  ) : null}
                  {!isLastAdmin ? (
                    <form action={removeMember}>
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <SubmitButton variant="danger" confirm={`Remove ${m.user.name} from ${org.name}? They lose access to every production here.`}>
                        Remove
                      </SubmitButton>
                    </form>
                  ) : (
                    <span className="text-xs text-muted">Only admin</span>
                  )}
                </div>
              </div>
              {/* Password help without a mailer: a one-time link the admin can text them. */}
              <Disclosure className="pl-12 sm:pl-0">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-accent">
                  Reset password
                </summary>
                <div className="mt-1 rounded-xl border border-line bg-surface-2 p-3">
                  <p className="mb-3 text-sm text-muted">
                    Get a one-time link for {firstName} to choose a new password. It expires in 1 hour, and using it signs them out of
                    every other device.
                  </p>
                  <ActionForm
                    action={issuePasswordResetLink}
                    submitLabel="Get reset link"
                    submitVariant="secondary"
                    pendingLabel="Creating…"
                    linkNote="Send it by text or read it out in person. It works once and expires in 1 hour."
                  >
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="userId" value={m.user.id} />
                  </ActionForm>
                </div>
              </Disclosure>
            </div>
          );
        })}
      </List>
    </div>
  );
}
