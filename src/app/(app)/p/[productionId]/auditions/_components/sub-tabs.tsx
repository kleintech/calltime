"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

/** Segmented control for an audition's sub-views. Scrolls horizontally on narrow phones. */
export function SubTabs({ base, tabs }: { base: string; tabs: { slug: string; label: string; count?: number }[] }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] print:hidden">
      <div className="inline-flex min-w-full gap-1 rounded-xl bg-surface-2 p-1 sm:min-w-0">
        {tabs.map((t) => {
          const href = `${base}/${t.slug}`;
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={t.slug}
              href={href}
              className={cn(
                "flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition",
                active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              {t.count ? <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-accent-soft text-accent" : "bg-surface text-muted")}>{t.count}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
