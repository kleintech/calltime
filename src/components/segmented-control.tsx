"use client";

import { useState, type ReactNode } from "react";
import { cn } from "./ui";

export type SegmentOption<T extends string = string> = { value: T; label: ReactNode; icon?: ReactNode };

/**
 * iOS-style segmented control with a sliding thumb. Equal-width segments, 2–4 options.
 * Controlled (value + onChange) or uncontrolled (defaultValue). With `name` it also submits the
 * value in a <form> via a hidden input. For URL-driven switches use <SegmentedLinks> from ui.tsx.
 */
export function SegmentedControl<T extends string>({
  options,
  value: valueProp,
  defaultValue,
  onChange,
  name,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  options: SegmentOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  name?: string;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const [inner, setInner] = useState<T>(defaultValue ?? options[0]?.value);
  const value = valueProp ?? inner;
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const select = (v: T) => {
    if (valueProp === undefined) setInner(v);
    onChange?.(v);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("relative grid rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line/60", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const next = (index + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length;
        select(options[next].value);
        (e.currentTarget.querySelectorAll("button")[next] as HTMLButtonElement | undefined)?.focus();
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-surface shadow-card transition-transform duration-300 ease-[var(--ease-out)]"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o, i) => {
        const active = i === index;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-3 font-semibold whitespace-nowrap transition-colors [&_svg]:size-4",
              size === "sm" ? "min-h-8 text-sm" : "min-h-9 text-[15px]",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
