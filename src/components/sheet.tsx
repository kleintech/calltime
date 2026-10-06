"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { buttonClass, cn, type ButtonVariant } from "./ui";

/*
 * Bottom sheet on phones, centered dialog on ≥ sm. Built on native <dialog> (focus trap, Esc,
 * top layer, inert background for free).
 *
 * Uncontrolled — usable straight from a server component:
 *   <Sheet trigger={<Button>Add block</Button>} title="Add block">…form…</Sheet>
 * Controlled — from a client component:
 *   <Sheet open={open} onOpenChange={setOpen} title="Publish 3 rehearsals?">…</Sheet>
 * Inside, <SheetClose>Not yet</SheetClose> closes it; `closeOnSubmit` closes after any form submits.
 * `footer` renders in a sticky bottom area (primary action last, full width on phones).
 */
export function Sheet({
  trigger,
  title,
  description,
  children,
  footer,
  open: openProp,
  onOpenChange,
  closeOnSubmit = false,
  className,
}: {
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeOnSubmit?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const titleId = useId();
  const descId = useId();

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setOpenState(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      {trigger ? (
        <span className="contents" onClick={() => setOpen(true)}>
          {trigger}
        </span>
      ) : null}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // Click on the backdrop (the dialog element itself, outside the panel) closes.
          if (e.target === e.currentTarget) setOpen(false);
        }}
        onSubmit={closeOnSubmit ? () => setTimeout(() => setOpen(false), 0) : undefined}
        className={cn(
          "ct-sheet flex-col overflow-hidden border border-line/80 bg-surface p-0 text-ink shadow-overlay open:flex backdrop:bg-transparent",
          className,
        )}
      >
        <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" />
        <header className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-3 sm:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[15px] text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="-mr-2 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-surface px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end sm:pb-4 [&>*]:w-full sm:[&>*]:w-auto">
            {footer}
          </footer>
        ) : (
          <div aria-hidden className="h-[env(safe-area-inset-bottom)] shrink-0" />
        )}
      </dialog>
    </>
  );
}

/** A button that closes the enclosing Sheet. */
export function SheetClose({
  children = "Close",
  variant = "secondary",
  className,
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={buttonClass(variant, className)}
      onClick={(e) => e.currentTarget.closest("dialog")?.close()}
    >
      {children}
    </button>
  );
}
