import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { orgMembers, organizations, users } from "@/db/schema";
import { Avatar, Badge, Card, Field, Input, LinkButton, List, Notice, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { COMMON_TIMEZONES } from "@/lib/time";
import { ActionForm, SubmitButton } from "../../org/_components/action-form";
import { PendingInvites } from "../../org/_components/pending-invites";
import { getPendingInvites, UUID_RE } from "../../org/_lib/org";
import { removeMember, setMemberRole } from "../../org/members/actions";
import { addOrgAdmin, setPlatformAdmin, updateOrg } from "../actions";

export const metadata = { title: "Company" };

export default async function AdminOrgPage({ params, searchParams }: PageProps<"/admin/[orgId]">) {
  const me = await requirePlatformAdmin();
  const { orgId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(orgId)) notFound();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) notFound();

  const [members, pending] = await Promise.all([
    db
      .select({ user: users, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, org.id))
      .orderBy(orgMembers.role, users.name),
    getPendingInvites(org.id),
  ]);
  const adminCount = members.filter((m) => m.role === "admin").length;

  return (
    <div>
      <PageHeader
        back={{ href: "/admin", label: "All companies" }}
        title={org.name}
        subtitle={<span className="font-mono text-xs">{org.slug}</span>}
        actions={
          <LinkButton href={`/org?org=${org.id}`} variant="secondary">
            Open company area
          </LinkButton>
        }
      />

      {sp.created ? (
        <div className="mb-4">
          <Notice tone="success">
            {org.name} is ready.{" "}
            {pending.length ? "Send the first admin their invite link below." : "The first admin already had an account and can sign in now."}
          </Notice>
        </div>
      ) : null}

      {pending.length ? (
        <>
          <SectionTitle>Pending invites</SectionTitle>
          <PendingInvites orgId={org.id} timezone={org.timezone} items={pending} />
        </>
      ) : null}

      <SectionTitle>Members · {members.length}</SectionTitle>
      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-muted">Nobody has joined yet.</p>
      ) : (
        <List>
          {members.map((m) => {
            const isLastAdmin = m.role === "admin" && adminCount <= 1;
            return (
              <div key={m.user.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={m.user.name} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{m.user.name}</span>
                      {m.role === "admin" ? <Badge tone="accent">Admin</Badge> : null}
                      {m.user.isPlatformAdmin ? <Badge tone="gold">Platform</Badge> : null}
                    </div>
                    <div className="truncate text-sm text-muted">{m.user.email}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pl-12 sm:pl-0">
                  {!isLastAdmin ? (
                    <form action={setMemberRole}>
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                      <SubmitButton>{m.role === "admin" ? "Demote" : "Make admin"}</SubmitButton>
                    </form>
                  ) : null}
                  {m.user.id !== me.id ? (
                    <form action={setPlatformAdmin}>
                      <input type="hidden" name="userId" value={m.user.id} />
                      <input type="hidden" name="value" value={m.user.isPlatformAdmin ? "false" : "true"} />
                      <SubmitButton
                        variant="ghost"
                        confirm={
                          m.user.isPlatformAdmin
                            ? `Remove platform admin from ${m.user.name}?`
                            : `Make ${m.user.name} a platform admin? They'll be able to manage every company.`
                        }
                      >
                        {m.user.isPlatformAdmin ? "Revoke platform" : "Platform admin"}
                      </SubmitButton>
                    </form>
                  ) : null}
                  {!isLastAdmin ? (
                    <form action={removeMember}>
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <SubmitButton variant="danger" confirm={`Remove ${m.user.name} from ${org.name}?`}>
                        Remove
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </List>
      )}

      <SectionTitle>Add an admin</SectionTitle>
      <Card>
        <ActionForm action={addOrgAdmin} submitLabel="Add admin" resetOnSuccess pendingLabel="Adding…">
          <input type="hidden" name="orgId" value={org.id} />
          <Field label="Email" hint="Existing accounts become admins right away; anyone else gets an invite link.">
            <Input name="email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Name (optional)">
            <Input name="name" autoComplete="off" />
          </Field>
        </ActionForm>
      </Card>

      <SectionTitle>Settings</SectionTitle>
      <Card>
        <ActionForm action={updateOrg} submitLabel="Save">
          <input type="hidden" name="orgId" value={org.id} />
          <Field label="Company name">
            <Input name="name" required defaultValue={org.name} />
          </Field>
          <Field label="Timezone">
            <Select name="timezone" defaultValue={org.timezone}>
              {(COMMON_TIMEZONES.includes(org.timezone) ? COMMON_TIMEZONES : [org.timezone, ...COMMON_TIMEZONES]).map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
