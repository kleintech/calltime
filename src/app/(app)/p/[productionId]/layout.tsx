import Link from "next/link";
import { ProductionTabs, type ProductionTab } from "@/components/production-tabs";
import { Badge } from "@/components/ui";
import { requireProductionAccess } from "@/lib/access";

const STATUS_LABEL = {
  planning: "Planning",
  auditions: "Auditions",
  rehearsals: "In rehearsal",
  performances: "Performing",
  closed: "Closed",
} as const;

/** Production header + tabs. Editors see management tabs; cast/guardians see a read-only subset. */
export default async function ProductionLayout({ children, params }: LayoutProps<"/p/[productionId]">) {
  const { productionId } = await params;
  const { production, canEdit, org } = await requireProductionAccess(productionId);
  const base = `/p/${productionId}`;

  const tabs: ProductionTab[] = canEdit
    ? [
        { href: base, label: "Overview" },
        { href: `${base}/schedule`, label: "Schedule" },
        { href: `${base}/scenes`, label: "Scenes" },
        { href: `${base}/roles`, label: "Roles" },
        { href: `${base}/cast`, label: "Cast" },
        { href: `${base}/breakdown`, label: "Breakdown" },
        { href: `${base}/auditions`, label: "Auditions" },
        { href: `${base}/team`, label: "Team" },
        { href: `${base}/settings`, label: "Settings" },
      ]
    : [
        { href: base, label: "Overview" },
        { href: `${base}/schedule`, label: "Schedule" },
        { href: `${base}/cast`, label: "Cast & Team" },
      ];

  return (
    <div>
      <div className="mb-3">
        <Link href="/productions" className="text-sm text-muted hover:text-ink">
          ← {org.name}
        </Link>
        <div className="mt-1 flex items-start gap-3">
          <span className="mt-2 size-3 shrink-0 rounded-full" style={{ background: production.accentColor }} />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{production.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              {production.subtitle ? <span>{production.subtitle}</span> : null}
              <Badge tone="accent">{STATUS_LABEL[production.status]}</Badge>
            </div>
          </div>
        </div>
      </div>
      <ProductionTabs tabs={tabs} base={base} />
      {children}
    </div>
  );
}
