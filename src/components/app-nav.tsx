"use client";

import {
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleUserRound,
  Drama,
  Shield,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, cn, LogoMark, Wordmark } from "./ui";

export type NavIcon = "calls" | "productions" | "org" | "admin" | "account" | "calendar" | "schedule" | "show";
export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Extra path prefixes that also mark this item active (weaker than an href match). */
  match?: string[];
  /** Desktop rail only (e.g. platform Admin) — keeps the phone tab bar to ≤ 5. */
  railOnly?: boolean;
};

const icons: Record<NavIcon, LucideIcon> = {
  calls: CalendarClock,
  calendar: CalendarDays,
  schedule: CalendarRange,
  show: Drama,
  productions: Drama,
  org: Building2,
  admin: Shield,
  account: CircleUserRound,
};

/** The most specific item wins: exact href > longest href prefix > `match` prefix. */
function activeHref(pathname: string, items: NavItem[]) {
  let best: string | null = null;
  let bestScore = 0;
  for (const it of items) {
    let score = 0;
    if (pathname === it.href) score = 10_000;
    else if (pathname.startsWith(it.href + "/")) score = it.href.length;
    else if (it.href === "/productions" && pathname.startsWith("/p/")) score = 0.5; // legacy default
    for (const m of it.match ?? []) if (pathname.startsWith(m)) score = Math.max(score, m.length - 0.5);
    if (score > bestScore) {
      bestScore = score;
      best = it.href;
    }
  }
  return best;
}

/**
 * App chrome. Phones: compact glass top bar + floating glass tab bar. ≥ md: left rail.
 * `user` (optional) shows an identity block at the bottom of the rail.
 */
export function AppNav({ items, user }: { items: NavItem[]; user?: { name: string; email?: string } }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  const tabItems = items.filter((i) => !i.railOnly);
  const adminItem = items.find((i) => i.railOnly && i.icon === "admin");

  return (
    <>
      <TopBar adminHref={adminItem?.href} adminActive={!!adminItem && active === adminItem.href} />

      {/* Phone tab bar */}
      <nav
        aria-label="Main"
        data-app-chrome
        className="fixed inset-x-3 bottom-[max(calc(env(safe-area-inset-bottom)-12px),10px)] z-40 mx-auto max-w-md rounded-[1.75rem] border border-glass-line p-1.5 shadow-overlay glass md:hidden"
      >
        <ul className="flex">
          {tabItems.map((it) => {
            const Icon = icons[it.icon];
            const on = it.href === active;
            return (
              <li key={it.href} className="min-w-0 flex-1">
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-[1.375rem] px-1 text-[12px] font-semibold leading-4 transition-colors duration-200",
                    on ? "bg-accent-soft text-accent" : "text-muted active:bg-ink/[.06]",
                  )}
                >
                  <Icon className={cn("size-6 transition-transform duration-200", on && "scale-105")} strokeWidth={on ? 2.3 : 1.8} />
                  <span className="max-w-full truncate">{it.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop rail */}
      <nav
        aria-label="Main"
        data-app-chrome
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface/70 px-3 pb-4 pt-5 backdrop-blur-xl md:flex"
      >
        <Link href="/home" className="mb-7 flex items-center gap-2.5 rounded-xl px-2 py-1">
          <LogoMark className="size-8" />
          <Wordmark className="text-[1.375rem]" />
        </Link>
        <ul className="space-y-0.5">
          {items.map((it) => {
            const Icon = icons[it.icon];
            const on = it.href === active;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
                    on ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-ink/[.05]",
                  )}
                >
                  <Icon className="size-5" strokeWidth={on ? 2.25 : 1.8} />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {user ? (
          <Link
            href="/account"
            className="mt-auto flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-ink/[.05]"
          >
            <Avatar name={user.name} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              {user.email ? <span className="block truncate text-xs text-muted">{user.email}</span> : null}
            </span>
          </Link>
        ) : null}
      </nav>
    </>
  );
}

/** Phone top bar: brand + status-bar scrim; turns to glass with a hairline once content scrolls under it. */
function TopBar({ adminHref, adminActive }: { adminHref?: string; adminActive?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      data-app-chrome
      className={cn(
        "sticky top-0 z-30 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,backdrop-filter] duration-200 md:hidden",
        scrolled ? "border-b border-glass-line glass" : "border-b border-transparent",
      )}
    >
      <div className="flex h-[var(--appbar-h)] items-center justify-between px-4">
        <Link href="/home" className="-ml-1 flex items-center gap-2 rounded-xl px-1 py-1" aria-label="Calltime home">
          <LogoMark className="size-7" />
          <Wordmark className="text-xl" />
        </Link>
        {adminHref ? (
          <Link
            href={adminHref}
            aria-label="Platform admin"
            aria-current={adminActive ? "page" : undefined}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-full hover:bg-ink/[.06]",
              adminActive ? "bg-accent-soft text-accent" : "text-muted hover:text-ink",
            )}
          >
            <Shield className="size-5" />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
