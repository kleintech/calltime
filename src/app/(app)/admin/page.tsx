import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers, organizations, people, productions, users } from "@/db/schema";
import { Avatar, Badge, Card, EmptyState, Field, Input, List, ListRow, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { COMMON_TIMEZONES } from "@/lib/time";
import { ActionForm } from "../org/_components/action-form";
import { createOrg } from "./actions";
import { OrgNameFields } from "./_lib/org-name-fields";

export const metadata = { title: "Platform admin" };

export default async function AdminPage() {
  await requirePlatformAdmin();
  const [orgs, members, admins, prods, ppl, platformAdmins] = await Promise.all([
    db.select().from(organizations).orderBy(organizations.name),
    db.select({ orgId: orgMembers.orgId, n: count() }).from(orgMembers).groupBy(orgMembers.orgId),
    db.select({ orgId: orgMembers.orgId, n: count() }).from(orgMembers).where(eq(orgMembers.role, "admin")).groupBy(orgMembers.orgId),
    db.select({ orgId: productions.orgId, n: count() }).from(productions).groupBy(productions.orgId),
    db.select({ orgId: people.orgId, n: count() }).from(people).groupBy(people.orgId),
    db.select().from(users).where(eq(users.isPlatformAdmin, true)).orderBy(users.name),
  ]);
  const m = (rows: { orgId: string; n: number }[]) => new Map(rows.map((r) => [r.orgId, r.n]));
  const [mM, aM, pM, peM] = [m(members), m(admins), m(prods), m(ppl)];

  return (
    <div>
      <PageHeader title="Platform admin" subtitle="Companies using Calltime and who runs them." />

      <SectionTitle>Companies · {orgs.length}</SectionTitle>
      {orgs.length === 0 ? (
        <EmptyState title="No companies yet" body="Create the first one below." />
      ) : (
        <List>
          {orgs.map((o) => (
            <ListRow
              key={o.id}
              href={`/admin/${o.id}`}
              title={o.name}
              subtitle={`${pM.get(o.id) ?? 0} productions · ${peM.get(o.id) ?? 0} people · ${mM.get(o.id) ?? 0} members`}
              right={!aM.get(o.id) ? <Badge tone="warn">No admin yet</Badge> : <span className="text-muted">›</span>}
            />
          ))}
        </List>
      )}

      <SectionTitle>New company</SectionTitle>
      <Card>
        <ActionForm action={createOrg} submitLabel="Create company" pendingLabel="Creating…">
          <OrgNameFields />
          <Field label="Timezone" hint="Every call time is shown in this timezone.">
            <Select name="timezone" defaultValue="America/New_York">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
            The first admin can create productions and invite everyone else. If they don&apos;t have an account yet you&apos;ll get
            an invite link to send them.
          </div>
          <Field label="First admin's email">
            <Input name="adminEmail" type="email" required autoComplete="off" placeholder="office@example.org" />
          </Field>
          <Field label="First admin's name (optional)">
            <Input name="adminName" autoComplete="off" />
          </Field>
        </ActionForm>
      </Card>

      <SectionTitle>Platform admins</SectionTitle>
      <List>
        {platformAdmins.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={u.name} />
            <div className="min-w-0">
              <div className="truncate font-medium">{u.name}</div>
              <div className="truncate text-sm text-muted">{u.email}</div>
            </div>
          </div>
        ))}
      </List>
      <p className="mt-2 text-xs text-muted">Grant or remove platform admin from a company&apos;s member list.</p>
    </div>
  );
}
