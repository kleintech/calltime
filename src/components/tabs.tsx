"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Sheet } from "./sheet";
import { cn } from "./ui";

export type NavTab = { href: string; label: string; count?: number; icon?: ReactNode };

function isTabActive(pathname: string, href: string, exactHref?: string) {
  if (href === exactHref) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Route tabs (a scrolling pill strip). Active tab follows the URL, gets aria-current, and is
 * scrolled into view. `exact` = the href that only matches exactly (usually the section root).
 * `more` tabs collapse into a "More" pill that opens a sheet — keep the strip to ≤ 4 visible tabs
 * on phones. `sticky` pins the strip under the top app bar with a glass background.
 */
export function NavTabs({
  tabs,
  more,
  exact,
  sticky = false,
  className,
  "aria-label": ariaLabel = "Sections",
}: {
  tabs: NavTab[];
  more?: NavTab[];
  exact?: string;
  sticky?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const pathname = usePathname();
  const scroller = useRef<HTMLUListElement>(null);
  const activeMore = more?.find((t) => isTabActive(pathname, t.href, exact));

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>("[aria-current=page]");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [pathname]);

  const pill = (active: boolean) =>
    cn(
      "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[15px] font-semibold transition-colors duration-150 [&_svg]:size-4",
      active ? "bg-ink text-bg" : "text-muted hover:bg-ink/[.05] hover:text-ink",
    );

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        sticky &&
          "sticky top-[calc(var(--appbar-h)+env(safe-area-inset-top))] z-20 -mx-4 border-b border-line/70 bg-bg/95 px-4 backdrop-blur-xl md:top-0 md:-mx-8 md:px-8",
        className,
      )}
    >
      <ul ref={scroller} className="fade-x -mx-4 flex scroll-px-8 gap-1 overflow-x-auto px-4 py-2 scrollbar-none md:mx-0 md:px-0 md:[mask-image:none]">
        {tabs.map((t) => {
          const active = isTabActive(pathname, t.href, exact);
          return (
            <li key={t.href} className="shrink-0">
              <Link href={t.href} aria-current={active ? "page" : undefined} className={pill(active)}>
                {t.icon}
                {t.label}
                {t.count != null ? <span className="tabular text-xs opacity-70">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
        {more && more.length > 0 ? (
          <li className="shrink-0">
            <MoreTabs more={more} active={activeMore} pillClass={pill(!!activeMore)} />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function MoreTabs({ more, active, pillClass }: { more: NavTab[]; active?: NavTab; pillClass: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close when navigation happens from inside the sheet.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        className={pillClass}
        aria-haspopup="dialog"
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(true)}
      >
        {active ? active.label : "More"}
        <ChevronDown className="size-4 opacity-70" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="More">
        <ul className="-mx-2">
          {more.map((t) => {
            const isActive = t.href === active?.href;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors [&_svg]:size-5",
                    isActive ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
                  )}
                >
                  {t.icon}
                  <span className="flex-1">{t.label}</span>
                  {t.count != null ? <span className="tabular text-sm text-muted">{t.count}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

/**
 * In-page tabs with panels (state only, no URL). Panels can be server-rendered content.
 *   <Tabs items={[{ value: "scenes", label: "Scenes", content: <ScenePicker/> }, …]} />
 */
export function Tabs({
  items,
  defaultValue,
  className,
  "aria-label": ariaLabel,
}: {
  items: { value: string; label: ReactNode; content: ReactNode; count?: number }[];
  defaultValue?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? items[0]?.value);
  const baseId = useId();
  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="fade-x -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 scrollbar-none"
      >
        {items.map((it) => {
          const active = it.value === value;
          return (
            <button
              key={it.value}
              type="button"
              role="tab"
              id={`${baseId}-t-${it.value}`}
              aria-selected={active}
              aria-controls={`${baseId}-p-${it.value}`}
              onClick={() => setValue(it.value)}
              className={cn(
                "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-[15px] font-semibold whitespace-nowrap transition-colors",
                active ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {it.label}
              {it.count != null ? <span className="tabular text-xs text-muted">{it.count}</span> : null}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-2 -bottom-px h-[3px] rounded-t-full bg-accent transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
      {items.map((it) => (
        <div
          key={it.value}
          role="tabpanel"
          id={`${baseId}-p-${it.value}`}
          aria-labelledby={`${baseId}-t-${it.value}`}
          hidden={it.value !== value}
          className="pt-4"
        >
          {it.content}
        </div>
      ))}
    </div>
  );
}
