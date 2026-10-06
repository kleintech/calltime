import { AppNav, type NavItem } from "@/components/app-nav";
import { getUserOrgs } from "@/lib/access";
import { requireUser } from "@/lib/auth";

/** Signed-in shell: bottom tabs on phones, side rail on desktop. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const orgs = await getUserOrgs(user);
  const adminOrg = orgs.find((o) => o.role === "admin");

  const items: NavItem[] = [
    { href: "/home", label: "My Calls", icon: "calls" },
    { href: "/productions", label: "Shows", icon: "productions" },
  ];
  if (adminOrg) items.push({ href: "/org", label: "Company", icon: "org" });
  if (user.isPlatformAdmin) items.push({ href: "/admin", label: "Admin", icon: "admin" });
  items.push({ href: "/account", label: "Account", icon: "account" });

  return (
    <div className="min-h-dvh md:pl-60">
      <AppNav items={items} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:pb-12 md:pt-10">{children}</main>
    </div>
  );
}
