"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import { COLOR_SWATCHES } from "./constants";

/** Swatch row + native color input. Submits `name` as a #rrggbb string (or "" when allowNone and cleared). */
export function ColorPicker({
  name,
  defaultValue,
  allowNone = false,
}: {
  name: string;
  defaultValue?: string | null;
  allowNone?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? (allowNone ? "" : COLOR_SWATCHES[0]));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="hidden" name={name} value={value} />
      {allowNone ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="No color"
          className={cn(
            "size-9 rounded-full border-2 border-dashed border-line text-xs text-muted",
            value === "" && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
          )}
        >
          –
        </button>
      ) : null}
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setValue(c)}
          aria-label={`Color ${c}`}
          className={cn("size-9 rounded-full", value.toLowerCase() === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
          style={{ background: c }}
        />
      ))}
      <label className="relative inline-flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-line text-xs text-muted">
        <span aria-hidden>+</span>
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={value || "#7c3aed"}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Custom color"
        />
      </label>
    </div>
  );
}
