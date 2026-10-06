"use client";

import { CalendarClock, Building2, Drama, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export type NavItem = { href: string; label: string; icon: "calls" | "productions" | "org" | "admin" | "account" };

const icons = { calls: CalendarClock, productions: Drama, org: Building2, admin: Shield, account: UserRound };

function isActive(pathname: string, href: string) {
  if (href === "/productions") return pathname === href || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(href + "/");
}

/** Bottom tab bar on mobile, left rail on ≥md. */
export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-safe md:hidden">
        <ul className="mx-auto flex max-w-lg">
          {items.map((it) => {
            const Icon = icons[it.icon];
            const active = isActive(pathname, it.href);
            return (
              <li key={it.href} className="flex-1">
                <Link
                  href={it.href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                    active ? "text-accent" : "text-muted",
                  )}
                >
                  <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <Link href="/home" className="mb-6 px-3 font-display text-2xl font-semibold tracking-tight">
          Call<span className="text-gold">time</span>
        </Link>
        <ul className="space-y-1">
          {items.map((it) => {
            const Icon = icons[it.icon];
            const active = isActive(pathname, it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    active ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-5" />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
