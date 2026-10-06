import { AppNav, type NavItem } from "@/components/app-nav";
import { getUserOrgs, getUserProductions } from "@/lib/access";
import { requireUser } from "@/lib/auth";

/**
 * Signed-in shell: glass top bar + floating tab bar on phones, side rail on desktop.
 * Tabs are computed from who the user is (docs/ux/GUIDELINES.md §1): the first tab always answers
 * their most frequent question, and no tab leads to an empty or forbidden page.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [orgs, productions] = await Promise.all([getUserOrgs(user), getUserProductions(user)]);
  const isOrgAdmin = orgs.some((o) => o.role === "admin");

  const active = productions.filter((p) => p.production.status !== "closed");
  const creative = active.filter((p) => p.relation === "creative");
  const isFamily = active.some((p) => p.relation === "cast");
  // A user with exactly one show (active or not) goes straight to it; otherwise the list.
  const onlyShow = productions.length === 1 ? productions[0].production : null;

  const items: NavItem[] = [{ href: "/home", label: "Calls", icon: "calls" }];

  if (creative.length > 0) {
    // The show they're most likely scheduling right now (no switcher yet: rehearsing > performing > auditions…).
    const rank = { rehearsals: 0, performances: 1, auditions: 2, planning: 3, closed: 4 } as const;
    const current = [...creative].sort((a, b) => rank[a.production.status] - rank[b.production.status])[0].production;
    items.push({ href: `/p/${current.id}/schedule`, label: "Schedule", icon: "schedule" });
  } else if (isFamily) {
    items.push({ href: "/home/calendar", label: "Calendar", icon: "calendar" });
  }

  if (onlyShow) items.push({ href: `/p/${onlyShow.id}`, label: "Show", icon: "show" });
  else if (productions.length > 0 || isOrgAdmin) items.push({ href: "/productions", label: "Shows", icon: "productions", match: ["/p/"] });

  if (isOrgAdmin) items.push({ href: "/org", label: "Company", icon: "org" });
  items.push({ href: "/account", label: "Me", icon: "account" });
  if (user.isPlatformAdmin) items.push({ href: "/admin", label: "Admin", icon: "admin", railOnly: true });

  return (
    <div data-app-shell className="min-h-dvh md:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-overlay"
      >
        Skip to content
      </a>
      <AppNav items={items} user={{ name: user.name, email: user.email }} />
      <main
        id="main"
        tabIndex={-1}
        data-page
        className="mx-auto w-full max-w-3xl px-4 outline-none pb-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+2rem)] pt-4 md:px-8 md:pb-16 md:pt-10"
      >
        {children}
      </main>
    </div>
  );
}
