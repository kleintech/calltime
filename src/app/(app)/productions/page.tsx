import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, EmptyState, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { getUserOrgs, getUserProductions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ProductionCard } from "./_components/production-card";

export default async function ProductionsPage() {
  const user = await requireUser();
  const [list, orgs] = await Promise.all([getUserProductions(user), getUserOrgs(user)]);
  const isAdmin = orgs.some((o) => o.role === "admin");
  // Families in exactly one current show skip the list of one and land on it.
  const active = list.filter((p) => p.production.status !== "closed");
  if (!isAdmin && active.length === 1 && list.every((p) => p.relation === "cast")) redirect(`/p/${active[0].production.id}`);
  const multiOrg = orgs.length > 1;
  const orgName = new Map(orgs.map((o) => [o.org.id, o.org.name]));

  const order = (s: string) => (s === "closed" ? 1 : 0);
  const sorted = [...list].sort(
    (a, b) => order(a.production.status) - order(b.production.status) || a.production.title.localeCompare(b.production.title),
  );
  const groups = [
    { key: "creative", title: "On the creative team", items: sorted.filter((p) => p.relation === "creative") },
    { key: "cast", title: "In the cast", items: sorted.filter((p) => p.relation === "cast") },
    { key: "admin", title: isAdmin ? "Company productions" : "Productions", items: sorted.filter((p) => p.relation === "admin") },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Shows"
        subtitle="Every production you're part of."
        actions={
          isAdmin ? (
            <LinkButton href="/productions/new">
              <Plus className="size-4" /> New production
            </LinkButton>
          ) : null
        }
      />
      {groups.length === 0 ? (
        <EmptyState
          title="No shows yet"
          body={
            isAdmin
              ? "Create your first production to start building scenes, roles and a rehearsal schedule."
              : "When you're cast in a show or join a creative team, it will show up here."
          }
          action={isAdmin ? <LinkButton href="/productions/new">New production</LinkButton> : null}
        />
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            {groups.length > 1 || g.key !== "admin" ? <SectionTitle>{g.title}</SectionTitle> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {g.items.map(({ production, title }) => (
                <ProductionCard
                  key={production.id}
                  production={production}
                  extra={
                    <>
                      {title ? <Badge tone="gold">{title}</Badge> : null}
                      {multiOrg ? <span className="text-xs text-muted">{orgName.get(production.orgId)}</span> : null}
                    </>
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
