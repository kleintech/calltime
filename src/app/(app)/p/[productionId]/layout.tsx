import { Sparkles } from "lucide-react";
import { ProductionHeader, ProductionTabs, type ProductionTab } from "@/components/production-tabs";
import { Badge } from "@/components/ui";
import { getUserProductions, requireProductionAccess } from "@/lib/access";
import { dayKey } from "@/lib/time";

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "gold" | "success" }> = {
  planning: { label: "Planning", tone: "neutral" },
  auditions: { label: "Auditions", tone: "gold" },
  rehearsals: { label: "In rehearsal", tone: "accent" },
  performances: { label: "Performing", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

/** "Opens in 12 days" while opening night is ahead (within ~4 months). */
function openingCountdown(openingDate: string | null, tz: string) {
  if (!openingDate) return null;
  const [y, m, d] = openingDate.split("-").map(Number);
  const [ty, tm, td] = dayKey(new Date(), tz).split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (days < 0 || days > 120) return null;
  if (days === 0) return "Opening night";
  if (days === 1) return "Opens tomorrow";
  return `Opens in ${days} days`;
}

/**
 * Production header + tabs. Editors get the four most-used tabs plus "More"; cast and families get
 * a read-only subset (docs/ux/GUIDELINES.md §1).
 */
export default async function ProductionLayout({ children, params }: LayoutProps<"/p/[productionId]">) {
  const { productionId } = await params;
  const { production, canEdit, org, user } = await requireProductionAccess(productionId);
  const base = `/p/${productionId}`;

  let tabs: ProductionTab[];
  let more: ProductionTab[] | undefined;
  if (canEdit) {
    const t = {
      overview: { href: base, label: "Overview" },
      schedule: { href: `${base}/schedule`, label: "Schedule" },
      cast: { href: `${base}/cast`, label: "Cast" },
      scenes: { href: `${base}/scenes`, label: "Scenes" },
      roles: { href: `${base}/roles`, label: "Roles" },
      breakdown: { href: `${base}/breakdown`, label: "Breakdown" },
      auditions: { href: `${base}/auditions`, label: "Auditions" },
      team: { href: `${base}/team`, label: "Team" },
      settings: { href: `${base}/settings`, label: "Settings" },
      resources: { href: `${base}/resources`, label: "Resources" },
      notes: { href: `${base}/notes`, label: "Notes" },
      reports: { href: `${base}/reports`, label: "Reports" },
      volunteers: { href: `${base}/volunteers`, label: "Volunteers" },
    };
    // Four primary tabs + More (GUIDELINES §1). Overview lives in More so /p/<id> still has a home.
    if (production.status === "auditions") {
      tabs = [t.auditions, t.schedule, t.cast];
      more = [t.overview, t.scenes, t.roles, t.breakdown, t.resources, t.notes, t.reports, t.volunteers, t.team, t.settings];
    } else {
      tabs = [t.schedule, t.cast, t.scenes];
      more = [t.overview, t.roles, t.breakdown, t.resources, t.notes, t.reports, t.volunteers, t.auditions, t.team, t.settings];
    }
  } else {
    tabs = [
      { href: base, label: "Overview" },
      { href: `${base}/schedule`, label: "Schedule" },
      { href: `${base}/cast`, label: "Cast & Team" },
    ];
    more = [
      { href: `${base}/resources`, label: "Materials" },
      { href: `${base}/notes`, label: "Notes" },
      { href: `${base}/volunteers`, label: "Volunteer" },
    ];
  }

  // Back goes to the shows list only when there is a list to go back to (it redirects single-show
  // families straight back here); otherwise to Calls.
  const showCount = canEdit ? Infinity : (await getUserProductions(user)).length;
  const back = showCount > 1 ? { href: "/productions", label: org.name } : { href: "/home", label: "Calls" };

  const status = STATUS[production.status] ?? STATUS.planning;
  const countdown = openingCountdown(production.openingDate, org.timezone);

  return (
    <div>
      <ProductionHeader
        base={base}
        title={production.title}
        subtitle={production.subtitle}
        accentColor={production.accentColor}
        backHref={back.href}
        backLabel={back.label}
        meta={
          <>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {countdown ? (
              <Badge tone="gold">
                <Sparkles aria-hidden />
                {countdown}
              </Badge>
            ) : null}
          </>
        }
      />
      <ProductionTabs tabs={tabs} more={more} base={base} />
      <div data-page>{children}</div>
    </div>
  );
}
