import { eq, inArray } from "drizzle-orm";
import { Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { guardianships, people, productions, roleAssignments, roles } from "@/db/schema";
import { Avatar, Badge, Card, Checkbox, EmptyState, Field, Input, List, PageHeader, SectionTitle, cn } from "@/components/ui";
import { ActionForm } from "../_components/action-form";
import { OrgChrome } from "../_components/org-chrome";
import { orgHref, personName, resolveAdminOrg } from "../_lib/org";
import { createPerson } from "./actions";

export const metadata = { title: "People" };

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "performers", label: "Performers" },
  { key: "guardians", label: "Guardians" },
  { key: "minors", label: "Minors" },
  { key: "unguarded", label: "No guardian" },
  { key: "no-account", label: "No account" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function PeoplePage({ searchParams }: PageProps<"/org/people">) {
  const sp = await searchParams;
  const { org, orgs } = await resolveAdminOrg(sp.org);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter: FilterKey = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as FilterKey) : "all";

  const all = await db.select().from(people).where(eq(people.orgId, org.id)).orderBy(people.lastName, people.firstName);
  const ids = all.map((p) => p.id);
  const [links, casting] = ids.length
    ? await Promise.all([
        db.select().from(guardianships).where(inArray(guardianships.minorId, ids)),
        db
          .select({ personId: roleAssignments.personId, role: roles.name, production: productions.title, status: productions.status })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .innerJoin(productions, eq(productions.id, roles.productionId))
          .where(eq(productions.orgId, org.id)),
      ])
    : [[], []];

  const byId = new Map(all.map((p) => [p.id, p]));
  const guardianIds = new Set(links.map((l) => l.guardianId));
  const guardiansOf = new Map<string, string[]>();
  const wardsOf = new Map<string, string[]>();
  for (const l of links) {
    const g = byId.get(l.guardianId);
    const m = byId.get(l.minorId);
    if (g) guardiansOf.set(l.minorId, [...(guardiansOf.get(l.minorId) ?? []), g.firstName]);
    if (m) wardsOf.set(l.guardianId, [...(wardsOf.get(l.guardianId) ?? []), m.firstName]);
  }
  const rolesOf = new Map<string, string[]>();
  for (const c of casting) {
    if (c.status === "closed") continue;
    rolesOf.set(c.personId, [...(rolesOf.get(c.personId) ?? []), c.role]);
  }

  const needle = q.toLowerCase();
  const shown = all.filter((p) => {
    if (needle) {
      const hay = `${p.firstName} ${p.lastName} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    switch (filter) {
      case "performers":
        return rolesOf.has(p.id);
      case "guardians":
        return guardianIds.has(p.id);
      case "minors":
        return p.isMinor;
      case "unguarded":
        return p.isMinor && !guardiansOf.has(p.id) && !p.userId;
      case "no-account":
        return !p.userId;
      default:
        return true;
    }
  });

  return (
    <div>
      <PageHeader title="People" subtitle="Performers and families. People carry over from show to show." />
      <OrgChrome org={org} orgs={orgs} active="people" path="/org/people" />

      <form className="relative" action="/org/people">
        <input type="hidden" name="org" value={org.id} />
        {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input name="q" defaultValue={q} placeholder="Search name, email, phone" aria-label="Search people" className="pl-9" type="search" />
      </form>

      <div className="-mx-4 mt-3 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={orgHref("/org/people", org.id, { ...(f.key !== "all" ? { filter: f.key } : {}), ...(q ? { q } : {}) })}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium",
                f.key === filter ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <SectionTitle>
        {shown.length} {shown.length === 1 ? "person" : "people"}
        {q ? ` matching “${q}”` : ""}
      </SectionTitle>
      {shown.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No people yet" : "Nobody matches"}
          body={all.length === 0 ? "Add people below, or cast them from audition signups." : "Try a different search or filter."}
        />
      ) : (
        <List>
          {shown.map((p) => {
            const r = rolesOf.get(p.id);
            const g = guardiansOf.get(p.id);
            const w = wardsOf.get(p.id);
            const sub = [
              r ? r.slice(0, 3).join(", ") + (r.length > 3 ? ` +${r.length - 3}` : "") : null,
              g ? `Guardian: ${g.join(", ")}` : null,
              w ? `Guardian of ${w.join(", ")}` : null,
              !r && !g && !w ? (p.email ?? null) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link
                key={p.id}
                href={`/org/people/${p.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2 active:bg-surface-2"
              >
                <Avatar name={personName(p)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{personName(p)}</span>
                    {p.isMinor ? <Badge>Minor</Badge> : null}
                  </div>
                  {sub ? <div className="truncate text-sm text-muted">{sub}</div> : null}
                </div>
                {p.userId ? (
                  <Badge tone="success">Account</Badge>
                ) : p.isMinor && !g ? (
                  <Badge tone="warn">No guardian</Badge>
                ) : null}
              </Link>
            );
          })}
        </List>
      )}

      <details className="group mt-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium text-accent">
          <UserPlus className="size-5" /> Add a person
        </summary>
        <Card className="mt-2">
          <ActionForm action={createPerson} submitLabel="Add person" pendingLabel="Adding…">
            <input type="hidden" name="orgId" value={org.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <Input name="firstName" required autoComplete="off" />
              </Field>
              <Field label="Last name (optional)">
                <Input name="lastName" autoComplete="off" />
              </Field>
            </div>
            <Field label="Email (optional)" hint="Skip for kids whose parent gets the account.">
              <Input name="email" type="email" autoComplete="off" />
            </Field>
            <Field label="Phone (optional)">
              <Input name="phone" type="tel" autoComplete="off" />
            </Field>
            <Checkbox name="isMinor" label="Under 18 (needs a guardian)" />
            <fieldset className="space-y-4 rounded-xl bg-surface-2 p-3">
              <legend className="sr-only">Guardian</legend>
              <p className="text-sm text-muted">For under-18s: who should see their calls? You can invite them on the next screen.</p>
              <Field label="Parent or guardian's name (optional)">
                <Input name="guardianName" autoComplete="off" />
              </Field>
              <Field label="Parent or guardian's email (optional)">
                <Input name="guardianEmail" type="email" autoComplete="off" />
              </Field>
            </fieldset>
          </ActionForm>
        </Card>
      </details>
    </div>
  );
}
