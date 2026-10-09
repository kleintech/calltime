"use client";

import { useState, type ComponentProps } from "react";

/**
 * <details> whose `defaultOpen` only sets the initial state, so it doesn't snap shut when the data
 * that decided it changes (e.g. after adding the first item from inside it).
 */
export function Disclosure({ defaultOpen = false, ...props }: Omit<ComponentProps<"details">, "open"> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details {...props} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} />;
}
