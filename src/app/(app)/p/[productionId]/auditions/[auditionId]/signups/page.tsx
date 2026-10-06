import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Search } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { auditionSignups, auditionSlots } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import { fullName, getAuditionForProduction, SIGNUP_STATUSES, STATUS_LABEL, type SignupStatus } from "@/lib/auditions";
import { fmtDay, fmtTime } from "@/lib/time";
import { Avatar, EmptyState, Input, cn } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { appBaseUrl } from "@/lib/invites";
import { Stars, StatusBadge } from "../../_components/signup-bits";

export default async function SignupsPage({ params, searchParams }: PageProps<"/p/[productionId]/auditions/[auditionId]/signups">) {
  const { productionId, auditionId } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && (SIGNUP_STATUSES as string[]).includes(sp.status) ? (sp.status as SignupStatus) : null;
  const { org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const audition = await getAuditionForProduction(productionId, auditionId);

  const counts = await db
    .select({ status: auditionSignups.status, n: sql<number>`count(*)::int` })
    .from(auditionSignups)
    .where(eq(auditionSignups.auditionId, auditionId))
    .groupBy(auditionSignups.status);
  const countOf = new Map(counts.map((c) => [c.status, c.n]));
  const active = counts.filter((c) => c.status !== "withdrawn").reduce((a, c) => a + c.n, 0);

  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = await db
    .select({ s: auditionSignups, slotStart: auditionSlots.startsAt })
    .from(auditionSignups)
    .leftJoin(auditionSlots, eq(auditionSlots.id, auditionSignups.slotId))
    .where(
      and(
        eq(auditionSignups.auditionId, auditionId),
        status ? eq(auditionSignups.status, status) : sql`${auditionSignups.status} <> 'withdrawn'`,
        q
          ? or(
              ilike(sql`${auditionSignups.firstName} || ' ' || ${auditionSignups.lastName}`, like),
              ilike(auditionSignups.email, like),
              ilike(auditionSignups.guardianName, like),
              ilike(auditionSignups.rolesInterested, like),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${auditionSlots.startsAt} asc nulls last`, asc(auditionSignups.lastName));

  const base = `/p/${productionId}/auditions/${auditionId}`;
  const href = (s: SignupStatus | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("status", s);
    const qs = p.toString();
    return `${base}/signups${qs ? `?${qs}` : ""}`;
  };
  const chips: { key: SignupStatus | null; label: string; n: number }[] = [
    { key: null, label: "All", n: active },
    ...SIGNUP_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], n: countOf.get(s) ?? 0 })).filter((c) => c.n > 0 || c.key === status),
  ];

  if (counts.length === 0) {
    const url = `${await appBaseUrl()}/audition/${audition.slug}`;
    return (
      <EmptyState
        title="No signups yet"
        body="Share the public link. Signups appear here as soon as people register."
        action={<CopyButton value={url} share />}
      />
    );
  }

  return (
    <div>
      <form className="relative mb-3" action={`${base}/signups`}>
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input name="q" defaultValue={q} placeholder="Search name, email, guardian, role" aria-label="Search signups" className="pl-9" type="search" />
      </form>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={href(c.key)}
            className={cn(
              "flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium",
              c.key === status ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No matches" body="Try a different search or filter." />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map(({ s, slotStart }) => (
            <Link key={s.id} href={`${base}/signups/${s.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <Avatar name={fullName(s)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{fullName(s)}</span>
                  {s.age != null ? <span className="shrink-0 text-sm text-muted">{s.age}</span> : null}
                  <Stars rating={s.rating} />
                </div>
                <div className="truncate text-sm text-muted">
                  {slotStart ? `${fmtDay(slotStart, tz)} · ${fmtTime(slotStart, tz)}` : "No slot"}
                  {s.rolesInterested ? ` · ${s.rolesInterested}` : ""}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </Link>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-muted">
        {rows.length} shown{status ? "" : " · withdrawn hidden"}
      </p>
    </div>
  );
}
