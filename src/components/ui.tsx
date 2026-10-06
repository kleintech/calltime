import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

/*
 * Shared UI primitives — see docs/DESIGN.md for usage.
 * Server-component safe (no hooks, no handlers). Interactive pieces live in their own "use client"
 * files: sheet.tsx (Sheet), segmented-control.tsx, tabs.tsx (NavTabs, Tabs), toast.tsx (toast).
 * Mobile-first: touch targets ≥ 44px, body text 16px, full-width forms on small screens.
 */

export const cn = clsx;

/* ───────────────────────────── Buttons ───────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "gold" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.005em] transition-[background-color,box-shadow,transform,color,opacity] duration-150 ease-out active:scale-[.97] disabled:opacity-45 disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:pointer-events-none [&_svg]:shrink-0";
const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3.5 text-sm [&_svg]:size-4",
  md: "min-h-11 px-5 text-[15px] [&_svg]:size-[18px]",
  lg: "min-h-13 px-6 text-base [&_svg]:size-5",
};
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink shadow-[var(--highlight),var(--accent-glow)] hover:bg-accent-hover",
  secondary: "bg-surface text-ink border border-line-strong/70 shadow-xs hover:bg-surface-2",
  ghost: "text-ink hover:bg-ink/[.06] active:bg-ink/[.09]",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-surface",
  "danger-solid": "bg-danger text-surface shadow-xs hover:brightness-110",
  soft: "bg-accent-soft text-accent hover:bg-accent hover:text-accent-ink",
  gold: "bg-gold-bright text-gold-ink shadow-[var(--highlight),0_6px_16px_-6px_rgb(233_165_60/.6)] hover:brightness-105",
};

/** Class string for anything that should look like a button (links, summary, label…). */
export function buttonClass(variant: ButtonVariant = "primary", className?: string, size: ButtonSize = "md") {
  return cn(buttonBase, buttonSizes[size], buttonVariants[variant], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, className, size)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, className, size)} {...props} />;
}

const iconButtonBase =
  "inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,transform,color] duration-150 active:scale-[.94] disabled:opacity-45 disabled:pointer-events-none";
const iconButtonSizes = { sm: "size-9 [&_svg]:size-[18px]", md: "size-11 [&_svg]:size-5", lg: "size-13 [&_svg]:size-6" };
const iconButtonVariants = {
  ghost: "text-ink hover:bg-ink/[.06] active:bg-ink/[.09]",
  secondary: "bg-surface text-ink border border-line-strong/70 shadow-xs hover:bg-surface-2",
  soft: "bg-accent-soft text-accent hover:brightness-95",
  primary: "bg-accent text-accent-ink shadow-[var(--highlight),var(--accent-glow)] hover:bg-accent-hover",
  glass: "glass text-ink border border-glass-line shadow-xs",
};
type IconButtonStyle = { variant?: keyof typeof iconButtonVariants; size?: keyof typeof iconButtonSizes };

/** Round icon-only button. `label` is required: it becomes the aria-label (and tooltip). */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<"button"> & IconButtonStyle & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(iconButtonBase, iconButtonSizes[size], iconButtonVariants[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconLinkButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & IconButtonStyle & { label: string }) {
  return (
    <Link
      aria-label={label}
      title={label}
      className={cn(iconButtonBase, iconButtonSizes[size], iconButtonVariants[variant], className)}
      {...props}
    >
      {children}
    </Link>
  );
}

/**
 * Floating action button: fixed bottom-right, above the tab bar on phones.
 * Pass `href` for a link, or button props (e.g. form action) otherwise. `label` shows when `extended`.
 */
export function Fab({
  href,
  label,
  icon,
  extended = false,
  className,
  ...props
}: { href?: string; label: string; icon: ReactNode; extended?: boolean } & Omit<ComponentProps<"button">, "children">) {
  const cls = cn(
    "fixed right-4 z-30 inline-flex items-center justify-center gap-2 rounded-full bg-accent text-accent-ink shadow-[var(--highlight),var(--accent-glow),var(--elev-3)] transition-transform duration-150 hover:bg-accent-hover active:scale-95 animate-pop [&_svg]:size-6",
    "bottom-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+16px)] md:bottom-8 md:right-8",
    extended ? "h-14 pl-5 pr-6 text-base font-semibold" : "size-14",
    className,
  );
  const content = (
    <>
      {icon}
      {extended ? <span>{label}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} aria-label={extended ? undefined : label} className={cls} data-app-chrome>
      {content}
    </Link>
  ) : (
    <button type="button" aria-label={extended ? undefined : label} className={cls} data-app-chrome {...props}>
      {content}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("size-5 animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────────── Surfaces ───────────────────────────── */

type CardTone = "default" | "accent" | "gold" | "inset" | "outline";
const cardTones: Record<CardTone, string> = {
  default: "border border-line/80 bg-surface shadow-card",
  accent: "border border-accent/15 bg-accent-soft",
  gold: "border border-gold-bright/25 bg-gold-soft",
  inset: "bg-surface-2",
  outline: "border border-dashed border-line-strong",
};
const cardPadding = { none: "", sm: "p-3", md: "p-4", lg: "p-5 sm:p-6" };

export function Card({
  className,
  tone = "default",
  padding = "md",
  interactive = false,
  ...props
}: ComponentProps<"div"> & { tone?: CardTone; padding?: keyof typeof cardPadding; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        cardTones[tone],
        cardPadding[padding],
        interactive && "transition-[box-shadow,transform] duration-200 hover:shadow-raised active:scale-[.99]",
        className,
      )}
      {...props}
    />
  );
}

/** A whole card that is one tap target. */
export function CardLink({
  className,
  tone = "default",
  padding = "md",
  ...props
}: ComponentProps<typeof Link> & { tone?: CardTone; padding?: keyof typeof cardPadding }) {
  return (
    <Link
      className={cn(
        "block rounded-2xl transition-[box-shadow,transform,background-color] duration-200 hover:shadow-raised active:scale-[.99]",
        cardTones[tone],
        cardPadding[padding],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Ticket / call-sheet stub: a card split by a perforated line with punched notches.
 * Use sparingly — for the one thing on a screen that *is* a ticket (the next call, an audition slot).
 */
export function Ticket({
  children,
  stub,
  className,
  accent,
}: {
  children: ReactNode;
  stub?: ReactNode;
  className?: string;
  /** Optional color for the top edge (e.g. production.accentColor). */
  accent?: string;
}) {
  return (
    <div
      className={cn("relative rounded-3xl bg-surface shadow-card ring-1 ring-line/80", className)}
      style={accent ? ({ "--ticket": accent } as CSSProperties) : undefined}
    >
      {accent ? (
        <div aria-hidden className="absolute inset-x-6 top-0 h-1 rounded-b-full" style={{ background: "var(--ticket)" }} />
      ) : null}
      <div className="p-5">{children}</div>
      {stub ? (
        <>
          <div aria-hidden className="relative mx-5 border-t-2 border-dashed border-line">
            <span className="absolute -left-[31px] -top-[11px] size-5 rounded-full bg-bg shadow-[inset_-1px_0_0_var(--line)]" />
            <span className="absolute -right-[31px] -top-[11px] size-5 rounded-full bg-bg shadow-[inset_1px_0_0_var(--line)]" />
          </div>
          <div className="px-5 pb-4 pt-3.5">{stub}</div>
        </>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Badges, chips, pills ───────────────────────────── */

export type Tone = "neutral" | "accent" | "gold" | "success" | "danger" | "warn";
const softTones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  gold: "bg-gold-soft text-gold",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 whitespace-nowrap [&_svg]:size-3.5",
        softTones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const chipBase =
  "inline-flex min-h-10 shrink-0 select-none items-center gap-2 rounded-full border px-4 text-[15px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[.97]";
const chipIdle = "border-line-strong/70 bg-surface text-ink hover:bg-surface-2";
const chipActive = "border-ink bg-ink text-bg";

/**
 * Filter chip. With `href` it's a link (e.g. ?p=maya); `active` styles the selected one and sets
 * aria-current. Optional `color` adds a leading dot (person color), `count` a trailing number.
 */
export function Chip({
  href,
  active = false,
  color,
  count,
  icon,
  children,
  className,
  ...props
}: {
  href?: string;
  active?: boolean;
  color?: string;
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"span">, "children">) {
  const inner = (
    <>
      {color ? <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} /> : null}
      {icon}
      {children}
      {count != null ? (
        <span className={cn("tabular text-xs font-semibold", active ? "opacity-70" : "text-muted")}>{count}</span>
      ) : null}
    </>
  );
  const cls = cn(chipBase, active ? chipActive : chipIdle, "[&_svg]:size-4", className);
  return href ? (
    <Link href={href} className={cls} aria-current={active ? "page" : undefined} scroll={false}>
      {inner}
    </Link>
  ) : (
    <span className={cls} {...props}>
      {inner}
    </span>
  );
}

/**
 * Toggle chip backed by a real checkbox (or radio) — works in plain <form>s and server actions,
 * no JS. `<ChipToggle name="days" value="mon" label="Mon" defaultChecked />`
 */
export function ChipToggle({
  label,
  color,
  type = "checkbox",
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; color?: string; type?: "checkbox" | "radio" }) {
  return (
    <label className={cn("relative inline-flex", className)}>
      <input type={type} className="peer sr-only" {...props} />
      <span
        className={cn(
          chipBase,
          chipIdle,
          "peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-45",
          "[&>.chk]:hidden peer-checked:[&>.chk]:inline-block",
        )}
      >
        <Check aria-hidden className="chk -ml-1 size-4" strokeWidth={2.5} />
        {color ? <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} /> : null}
        {label}
      </span>
    </label>
  );
}

/** Link-based segmented control (server-safe) — e.g. Week / Month, Upcoming / Past. */
export function SegmentedLinks({
  items,
  className,
  "aria-label": ariaLabel,
}: {
  items: { href: string; label: ReactNode; active?: boolean }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line/60", className)}>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          scroll={false}
          className={cn(
            "inline-flex min-h-9 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors",
            it.active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A time, shown as a pill (tabular digits). For call times in lists and blocks.
 * `strike` for cancelled (pair with a "Cancelled" badge — color is never the only signal).
 */
export function TimePill({
  children,
  tone = "neutral",
  size = "md",
  strike = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone | "solid";
  size?: "sm" | "md" | "lg";
  strike?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap [&_svg]:size-[1em]",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-3.5 py-1.5 text-base",
        tone === "solid" ? "bg-ink text-bg" : softTones[tone],
        strike && "line-through decoration-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The big call time: "Called" eyebrow + time range in display type (≥ 28px). The most prominent
 * thing on a call card.
 */
export function CallTime({
  children,
  label = "Called",
  size = "lg",
  strike = false,
  className,
}: {
  children: ReactNode;
  label?: ReactNode;
  size?: "md" | "lg" | "xl";
  strike?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? <div className="text-xs font-semibold uppercase tracking-[.08em] text-muted">{label}</div> : null}
      <div
        className={cn(
          "font-display tabular font-semibold tracking-tight text-ink",
          size === "md" && "text-2xl",
          size === "lg" && "text-[2rem] leading-[2.375rem]",
          size === "xl" && "text-[2.5rem] leading-[2.75rem] sm:text-5xl",
          strike && "text-muted line-through decoration-danger decoration-[3px]",
        )}
        style={{ fontVariationSettings: '"opsz" 72, "SOFT" 30' }}
      >
        {children}
      </div>
    </div>
  );
}

/** Same hash as personHue() in lib/schedule-shared, so chips match avatars. */
function hueOf(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Person chip: colored initial + first name. Name is always shown (color is a redundant cue). */
export function PersonChip({
  name,
  color,
  children,
  size = "md",
  className,
}: {
  name: string;
  color?: string;
  children?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const c = color ?? `hsl(${hueOf(name)} 45% 45%)`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "py-0.5 pl-0.5 pr-2 text-xs" : "py-1 pl-1 pr-3 text-sm",
        className,
      )}
      style={{ background: `color-mix(in oklab, ${c} 14%, transparent)` }}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center rounded-full font-bold text-white",
          size === "sm" ? "size-5 text-[10px]" : "size-6 text-[11px]",
        )}
        style={{ background: c }}
      >
        {name.trim().slice(0, 1).toUpperCase()}
      </span>
      <span className="text-ink">{children ?? name}</span>
    </span>
  );
}

/* ───────────────────────────── Forms ───────────────────────────── */

const fieldInput =
  "w-full rounded-xl border border-line-strong/80 bg-surface px-3.5 min-h-11 text-base text-ink shadow-[inset_0_1px_2px_rgb(var(--shadow-color)/.04)] placeholder:text-muted/80 transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-55 disabled:bg-surface-2 aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldInput, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldInput, "py-2.5 min-h-24 leading-relaxed", className)} {...props} />;
}

const chevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8396' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")";

export function Select({ className, style, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(fieldInput, "appearance-none bg-no-repeat pr-10", className)}
      style={{ backgroundImage: chevron, backgroundPosition: "right 0.75rem center", backgroundSize: "1.25rem", ...style }}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  optional = false,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  /** Inline error under the field. Also set aria-invalid on the input. */
  error?: ReactNode;
  /** Appends a quiet "(optional)" to the label. */
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[15px] font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </span>
      {children}
      {error ? (
        <span className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 py-1", className)}>
      <span className="relative inline-flex size-[22px] shrink-0">
        <input
          type="checkbox"
          className="peer size-[22px] cursor-pointer appearance-none rounded-[7px] border-[1.5px] border-line-strong bg-surface shadow-xs transition-colors checked:border-accent checked:bg-accent disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          {...props}
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-50 text-accent-ink opacity-0 transition-[opacity,transform] duration-150 peer-checked:scale-100 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-base leading-snug">{label}</span>
        {description ? <span className="block text-sm text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** iOS-style switch backed by a checkbox (works in plain forms). */
export function Switch({
  label,
  description,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-4 py-1", className)}>
      <span className="min-w-0">
        <span className="block text-base leading-snug">{label}</span>
        {description ? <span className="block text-sm text-muted">{description}</span> : null}
      </span>
      <span className="relative inline-flex h-[31px] w-[51px] shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 cursor-pointer appearance-none rounded-full bg-surface-3 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-200 checked:bg-success checked:shadow-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          {...props}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/.2),0_0_0_.5px_rgb(0_0_0/.04)] transition-transform duration-200 ease-[var(--ease-spring)] peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

/* ───────────────────────────── Page structure ───────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Small line above the title (e.g. a date, "Pirates of Penzance"). */
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back ? <BackLink href={back.href} label={back.label} className="mb-2" /> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? <p className="mb-1 text-sm font-medium text-muted">{eyebrow}</p> : null}
          <h1 className="font-display text-[1.875rem] font-semibold leading-[2.25rem] tracking-tight sm:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-base text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** "‹ Schedule" back affordance for non-tab screens. */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-2 inline-flex min-h-9 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] font-medium text-accent hover:bg-accent-soft",
        className,
      )}
    >
      <ChevronLeft aria-hidden className="size-5" strokeWidth={2.25} />
      {label}
    </Link>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 mt-8 flex min-h-8 items-center justify-between gap-2 first:mt-0", className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[.08em] text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** Larger in-page heading (Fraunces) for major sections like "Coming up". */
export function Heading({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 mt-10 flex items-center justify-between gap-2 first:mt-0", className)}>
      <h2 className="font-display text-xl font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  /** A lucide icon element, e.g. <CalendarDays />. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("spotlight rounded-3xl border border-line/80 bg-surface px-6 py-10 text-center", className)}>
      {icon ? (
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-gold-soft text-gold shadow-[var(--highlight)] [&_svg]:size-7">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
      {body ? <p className="mx-auto mt-1.5 max-w-sm text-base text-muted">{body}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A tappable list row. Shows a chevron when it's a link and nothing is passed in `right`. */
export function ListRow({
  href,
  title,
  subtitle,
  right,
  leading,
  chevron,
  className,
}: {
  href?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  /** Avatar, icon tile, time… on the left. */
  leading?: ReactNode;
  chevron?: boolean;
  className?: string;
}) {
  const showChevron = chevron ?? (!!href && !right);
  const inner = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle ? <div className="truncate text-sm text-muted">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
      {showChevron ? <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted/70" /> : null}
    </>
  );
  const cls = cn(
    "flex min-h-14 items-center gap-3 px-4 py-3",
    href && "transition-colors hover:bg-surface-2/70 active:bg-surface-2",
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Rounded container for ListRows with hairline dividers. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-line overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

/** Rounded icon tile for list leading slots and cards. */
export function IconTile({
  children,
  tone = "accent",
  color,
  size = "md",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /** Any CSS color (e.g. production accent); overrides tone. */
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" && "size-8 rounded-[10px] [&_svg]:size-4",
        size === "md" && "size-10 rounded-xl [&_svg]:size-5",
        size === "lg" && "size-12 rounded-[14px] [&_svg]:size-6",
        !color && softTones[tone],
        className,
      )}
      style={color ? { background: `color-mix(in oklab, ${color} 14%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  );
}

const avatarSizes = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof avatarSizes;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const h = hueOf(name);
  // A size-* in className wins over the size prop (older call sites pass className="size-12").
  const sized = /(^|\s)size-/.test(className ?? "") ? "" : avatarSizes[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface",
        sized,
        className,
      )}
      style={{ background: `linear-gradient(145deg, hsl(${h} 50% 54%), hsl(${h} 45% 40%))` }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

/** Inline banner. Tone picks an icon automatically; pass `icon={null}` to hide it. */
export function Notice({
  tone = "neutral",
  title,
  icon,
  action,
  children,
  className,
}: {
  tone?: "neutral" | "danger" | "success" | "warn" | "accent" | "gold";
  title?: ReactNode;
  icon?: ReactNode | null;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
    warn: "bg-warn-soft text-warn",
    accent: "bg-accent-soft text-accent",
    gold: "bg-gold-soft text-gold",
  };
  const DefaultIcon = { neutral: Info, danger: CircleAlert, success: CircleCheck, warn: TriangleAlert, accent: Info, gold: Info }[tone];
  const shownIcon = icon === undefined ? <DefaultIcon /> : icon;
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 text-[15px]", tones[tone], className)}>
      {shownIcon ? <span className="mt-px shrink-0 [&_svg]:size-5">{shownIcon}</span> : null}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={cn(title && "mt-0.5 opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="-my-1 shrink-0">{action}</div> : null}
    </div>
  );
}

/* ───────────────────────────── Data display ───────────────────────────── */

/** A number with a label — dashboards, counts ("23 called", "4 roles uncast"). */
export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        {icon ? <IconTile tone={tone} size="sm">{icon}</IconTile> : null}
      </div>
      <div className="mt-1 font-display text-3xl font-semibold tabular tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-sm text-muted">{hint}</div> : null}
    </>
  );
  const cls = cn("block rounded-2xl border border-line/80 bg-surface p-4 shadow-card", href && "transition-shadow hover:shadow-raised", className);
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Loading placeholder. Shape it like the content: <Skeleton className="h-6 w-40" />. */
export function Skeleton({ className, rounded = "lg" }: { className?: string; rounded?: "lg" | "full" | "2xl" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer bg-[length:200%_100%]",
        rounded === "lg" && "rounded-lg",
        rounded === "full" && "rounded-full",
        rounded === "2xl" && "rounded-2xl",
        className ?? "h-4 w-full",
      )}
      style={{
        backgroundImage: "linear-gradient(90deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%)",
      }}
    />
  );
}

/** Ready-made skeleton for a card/list loading state (use in loading.tsx). */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line/80 bg-surface p-4 shadow-card", className)} aria-busy>
      <div className="flex items-center gap-3">
        <Skeleton rounded="full" className="size-10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (
            <Skeleton key={i} className="h-3.5 w-3/4" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hairline divider, optionally with a centered label. */
export function Divider({ label, className }: { label?: ReactNode; className?: string }) {
  if (!label) return <hr className={cn("my-6 border-line", className)} />;
  return (
    <div className={cn("my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[.08em] text-muted", className)}>
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * Sticky action bar pinned above the tab bar (phones) / bottom of the content column (desktop):
 * long-form submit buttons, "3 drafts this week — Review & publish".
 * Leave room for it: add pb-24 to the page content.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-app-chrome
      className={cn(
        "fixed inset-x-3 z-30 animate-rise rounded-2xl border border-glass-line p-2.5 shadow-overlay glass",
        "bottom-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+10px)] md:bottom-6 md:left-[calc(15rem+1.5rem)] md:right-6 md:mx-auto md:max-w-[calc(48rem-1rem)]",
        className,
      )}
    >
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * Overflow menu with zero JS: a native popover. Bottom action sheet on phones, anchored dropdown on
 * desktop. Give each menu on a page a unique `id`.
 *   <Menu id="week-actions" label="Week actions"><MenuItem href="…" icon={<Copy />}>Duplicate last week</MenuItem></Menu>
 * MenuItem renders a <button> when no href — put it inside a <form action={…}> for server actions.
 */
export function Menu({
  id,
  label,
  trigger,
  children,
  className,
}: {
  id: string;
  label: string;
  /** Trigger content; defaults to a "⋯" icon. */
  trigger?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={trigger ? undefined : label}
        title={label}
        className={cn(trigger ? buttonClass("secondary") : cn(iconButtonBase, iconButtonSizes.md, iconButtonVariants.ghost), className)}
        style={{ anchorName: `--${id}` } as CSSProperties}
      >
        {trigger ?? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        )}
      </button>
      <div
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className="ct-menu overflow-hidden rounded-3xl border border-line/80 bg-surface p-1.5 text-ink shadow-overlay sm:rounded-2xl"
        style={{ positionAnchor: `--${id}` } as CSSProperties}
      >
        <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[.08em] text-muted sm:hidden">{label}</div>
        {children}
      </div>
    </>
  );
}

export function MenuItem({
  href,
  icon,
  tone = "default",
  children,
  className,
  ...props
}: { href?: string; icon?: ReactNode; tone?: "default" | "danger"; children: ReactNode } & Omit<ComponentProps<"button">, "children">) {
  const cls = cn(
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition-colors hover:bg-surface-2 sm:min-h-11 sm:text-[15px] [&_svg]:size-5 [&_svg]:shrink-0",
    tone === "danger" ? "text-danger" : "text-ink [&_svg]:text-muted",
    className,
  );
  return href ? (
    <Link href={href} role="menuitem" className={cls}>
      {icon}
      {children}
    </Link>
  ) : (
    <button type="button" role="menuitem" className={cls} {...props}>
      {icon}
      {children}
    </button>
  );
}

/** Wordmark: "Call" + gold "time" in Fraunces. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-semibold tracking-tight", className)} style={{ fontVariationSettings: '"SOFT" 100, "opsz" 72' }}>
      Call<span className="text-gold">time</span>
    </span>
  );
}

/** App mark: the clock "C" on a curtain-violet tile (matches the app icon). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 rounded-[28%] shadow-[var(--highlight)]", className)}
      style={{ background: "linear-gradient(160deg, #7c3aed, #3b0f86)" }}
    >
      <svg viewBox="0 0 64 64" className="size-full">
        <path d="M42.75 22.75A14.25 14.25 0 1 0 42.75 41.25" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M32 24.5V32l5 3.25" fill="none" stroke="#f2b859" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="47.5" cy="32" r="2.75" fill="#f2b859" />
      </svg>
    </span>
  );
}
