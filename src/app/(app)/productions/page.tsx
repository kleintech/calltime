import { ChevronDown, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, EmptyState, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { getUserOrgs, getUserProductions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ProductionCard } from "./_components/production-card";

export default async function ProductionsPage() {
  const user = await requireUser();
  const [list, orgs] = await Promise.all([getUserProductions(user), getUserOrgs(user)]);
  const isAdmin = orgs.some((o) => o.role === "admin");
  // A family with exactly one show in total (closed ones included) skips the list of one. With past
  // shows too, they get the list so the closed ones stay reachable under "Past shows".
  if (!isAdmin && list.length === 1 && list[0].relation === "cast") redirect(`/p/${list[0].production.id}`);
  const multiOrg = orgs.length > 1;
  const orgName = new Map(orgs.map((o) => [o.org.id, o.org.name]));

  const sorted = [...list].sort((a, b) => a.production.title.localeCompare(b.production.title));
  const current = sorted.filter((p) => p.production.status !== "closed");
  const past = sorted.filter((p) => p.production.status === "closed");
  const groups = [
    { key: "creative", title: "On the creative team", items: current.filter((p) => p.relation === "creative") },
    { key: "cast", title: "In the cast", items: current.filter((p) => p.relation === "cast") },
    { key: "admin", title: isAdmin ? "Company productions" : "Productions", items: current.filter((p) => p.relation === "admin") },
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
      {groups.length === 0 && past.length === 0 ? (
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
      {groups.length === 0 && past.length > 0 ? (
        <p className="text-sm text-muted">No current shows. Past shows are below.</p>
      ) : null}
      {past.length ? (
        <details className="group mt-6 rounded-2xl border border-line bg-surface" open={groups.length === 0}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
            <span>Past shows · {past.length}</span>
            <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
            {past.map(({ production, title }) => (
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
        </details>
      ) : null}
    </div>
  );
}
