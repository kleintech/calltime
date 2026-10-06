"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { NavTabs } from "./tabs";
import { cn } from "./ui";

export type ProductionTab = { href: string; label: string; count?: number };

/**
 * Sticky pill tab strip under the production header. `base` is the production root (only matches
 * exactly). `more` collapses rarely-used tabs into a "More" sheet.
 */
export function ProductionTabs({ tabs, base, more }: { tabs: ProductionTab[]; base: string; more?: ProductionTab[] }) {
  return <NavTabs tabs={tabs} more={more} exact={base} sticky aria-label="Production sections" className="mb-6" />;
}

/**
 * Production header. Full "poster" header on the production root; on sub-pages it collapses to
 * one line on phones so content starts above the fold.
 */
export function ProductionHeader({
  base,
  title,
  subtitle,
  accentColor,
  backHref,
  backLabel,
  meta,
}: {
  base: string;
  title: string;
  subtitle?: string | null;
  accentColor: string;
  backHref: string;
  backLabel: string;
  /** Badges / countdown shown under the title. */
  meta?: ReactNode;
}) {
  const pathname = usePathname();
  const compact = pathname !== base;
  return (
    <header
      className="relative isolate -mx-4 -mt-4 mb-1 px-4 pb-3 pt-3 md:-mx-8 md:-mt-10 md:px-8 md:pb-4 md:pt-8"
      style={{ "--prod": accentColor } as CSSProperties}
    >
      {/* Poster wash in the production's own color, fading into the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -top-[calc(var(--appbar-h)+env(safe-area-inset-top))] -z-10 md:top-0 md:[mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]"
        style={{
          background:
            "radial-gradient(90% 120% at 0% 0%, color-mix(in oklab, var(--prod) 22%, transparent), transparent 70%), radial-gradient(60% 80% at 100% 0%, color-mix(in oklab, var(--gold-bright) 12%, transparent), transparent 70%)",
        }}
      />
      <Link
        href={backHref}
        className="-ml-2 inline-flex min-h-9 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] font-medium text-muted transition-colors hover:bg-ink/[.05] hover:text-ink"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {backLabel}
      </Link>
      <div className={cn("flex items-start gap-3", compact ? "mt-0.5 max-md:items-center" : "mt-2")}>
        <span
          aria-hidden
          className={cn(
            "shrink-0 rounded-full shadow-[0_0_0_4px_color-mix(in_oklab,var(--prod)_18%,transparent)]",
            compact ? "mt-3 size-3 max-md:mt-0 max-md:size-2.5" : "mt-3 size-3 md:mt-4",
          )}
          style={{ background: "var(--prod)" }}
        />
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              "font-display font-semibold tracking-tight",
              compact
                ? "text-[1.875rem] leading-9 max-md:truncate max-md:text-xl max-md:leading-7 md:text-4xl md:leading-[2.75rem]"
                : "text-[2rem] leading-[2.375rem] md:text-[2.75rem] md:leading-[3.25rem]",
            )}
            style={{ fontVariationSettings: '"opsz" 96, "SOFT" 40' }}
          >
            {title}
          </h1>
          <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-muted", compact && "max-md:hidden")}>
            {subtitle ? <span>{subtitle}</span> : null}
            {meta}
          </div>
        </div>
      </div>
    </header>
  );
}
