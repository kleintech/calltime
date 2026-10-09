import { count, desc, eq, and, isNull, gt } from "drizzle-orm";
import { Building2, KeyRound, Plus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { guardianships, invites, orgMembers, people, productions } from "@/db/schema";
import { Badge, Card, EmptyState, LinkButton, List, ListRow, PageHeader, SectionTitle } from "@/components/ui";
import { fmtDay } from "@/lib/time";
import { OrgChrome } from "./_components/org-chrome";
import { orgHref, resolveAdminOrg } from "./_lib/org";

export const metadata = { title: "Company" };

const STATUS = {
  planning: { label: "Planning", tone: "neutral" },
  auditions: { label: "Auditions", tone: "gold" },
  rehearsals: { label: "In rehearsal", tone: "accent" },
  performances: { label: "Performing", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
} as const;

export default async function OrgDashboard({ searchParams }: PageProps<"/org">) {
  const sp = await searchParams;
  const { org, orgs } = await resolveAdminOrg(sp.org);

  const [prods, [peopleCount], [minorCount], [memberCount], [pendingCount], guardianRows] = await Promise.all([
    db.select().from(productions).where(eq(productions.orgId, org.id)).orderBy(desc(productions.createdAt)),
    db.select({ n: count() }).from(people).where(eq(people.orgId, org.id)),
    db.select({ n: count() }).from(people).where(and(eq(people.orgId, org.id), eq(people.isMinor, true))),
    db.select({ n: count() }).from(orgMembers).where(eq(orgMembers.orgId, org.id)),
    db
      .select({ n: count() })
      .from(invites)
      .where(and(eq(invites.orgId, org.id), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date()))),
    db
      .selectDistinct({ id: guardianships.minorId })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.minorId))
      .where(eq(people.orgId, org.id)),
  ]);
  const minorsWithoutGuardian = Math.max(0, (minorCount?.n ?? 0) - guardianRows.length);

  const active = prods.filter((p) => p.status !== "closed");
  const closed = prods.filter((p) => p.status === "closed");

  const stats = [
    { label: "People", value: peopleCount?.n ?? 0, href: orgHref("/org/people", org.id) },
    { label: "Members", value: memberCount?.n ?? 0, href: orgHref("/org/members", org.id) },
    { label: "Pending invites", value: pendingCount?.n ?? 0, href: orgHref("/org/members", org.id) },
  ];

  return (
    <div>
      <PageHeader
        title={org.name}
        subtitle={`Company admin · ${org.timezone.replace("_", " ")}`}
        actions={
          <LinkButton href="/productions/new">
            <Plus className="size-4" /> New production
          </LinkButton>
        }
      />
      <OrgChrome org={org} orgs={orgs} active="dashboard" />

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-2xl border border-line bg-surface p-3 hover:bg-surface-2 sm:p-4">
            <div className="font-display text-2xl font-semibold sm:text-3xl">{s.value}</div>
            <div className="text-xs text-muted sm:text-sm">{s.label}</div>
          </Link>
        ))}
      </div>

      {minorsWithoutGuardian > 0 ? (
        <Link
          href={orgHref("/org/people", org.id, { filter: "unguarded" })}
          className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn"
        >
          <span>
            {minorsWithoutGuardian} minor{minorsWithoutGuardian === 1 ? " has" : "s have"} no guardian on file — nobody will see
            their calls.
          </span>
          <span className="shrink-0 font-semibold">Fix →</span>
        </Link>
      ) : null}

      <SectionTitle action={<Link href="/productions/new" className="text-sm font-medium text-accent">+ New</Link>}>
        Productions
      </SectionTitle>
      {active.length === 0 ? (
        <EmptyState
          title="No productions yet"
          body="Create your first show, then add scenes, roles and the creative team."
          action={<LinkButton href="/productions/new">New production</LinkButton>}
        />
      ) : (
        <List>
          {active.map((p) => (
            <ListRow
              key={p.id}
              href={`/p/${p.id}`}
              title={
                <span className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.accentColor }} />
                  <span className="truncate">{p.title}</span>
                </span>
              }
              subtitle={[p.subtitle, p.openingDate ? `Opens ${fmtDay(`${p.openingDate}T12:00:00Z`, "UTC")}` : null]
                .filter(Boolean)
                .join(" · ")}
              right={<Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>}
            />
          ))}
        </List>
      )}
      {closed.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">Closed productions ({closed.length})</summary>
          <List className="mt-2">
            {closed.map((p) => (
              <ListRow key={p.id} href={`/p/${p.id}`} title={p.title} subtitle={p.subtitle} />
            ))}
          </List>
        </details>
      ) : null}

      <SectionTitle>Quick links</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { href: orgHref("/org/people", org.id), icon: Users, title: "People directory", body: "Performers, guardians and families" },
          { href: orgHref("/org/members", org.id), icon: UserPlus, title: "Invite & members", body: "Accounts, admins, pending links" },
          { href: orgHref("/org/api-keys", org.id), icon: KeyRound, title: "API keys", body: "Connect AI assistants via MCP" },
          { href: "/productions", icon: Building2, title: "All shows", body: "Every production you can open" },
        ].map((q) => (
          <Link key={q.title} href={q.href}>
            <Card className="flex items-center gap-3 hover:bg-surface-2">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <q.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{q.title}</span>
                <span className="block truncate text-sm text-muted">{q.body}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
