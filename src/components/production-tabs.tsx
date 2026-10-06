"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export type ProductionTab = { href: string; label: string };

/** Horizontally scrolling tab strip under the production header. */
export function ProductionTabs({ tabs, base }: { tabs: ProductionTab[]; base: string }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 mb-5 overflow-x-auto border-b border-line px-4 [scrollbar-width:none]">
      <ul className="flex gap-1">
        {tabs.map((t) => {
          const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={cn(
                  "block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
                  active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
