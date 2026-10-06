"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "./ui";

/*
 * Toasts. <Toaster /> is mounted once in the root layout. From any client code:
 *   toast("Published. 31 people notified.")
 *   toast("Block removed", { action: { label: "Undo", onClick: () => restore() } })
 *   toast("Couldn't save", { tone: "danger" })
 * From a server component (e.g. after a redirect with ?saved=1): <FlashToast message="Saved" />
 */

export type ToastTone = "neutral" | "success" | "danger";
export type ToastOptions = {
  tone?: ToastTone;
  /** ms before auto-dismiss. Default 4000; 8000 when an action (e.g. Undo) is present. */
  duration?: number;
  action?: { label: string; onClick: () => void };
};
type ToastItem = ToastOptions & { id: number; message: string };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const EMPTY: ToastItem[] = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let paused = false;

const durationOf = (t: ToastItem) => t.duration ?? (t.action ? 8000 : 4000);
function arm(t: ToastItem) {
  const d = durationOf(t);
  if (d > 0 && !paused) timers.set(t.id, setTimeout(() => dismissToast(t.id), d));
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
  // Dismissing ends the interaction that paused the stack (and on phones there's no mouseleave,
  // and the focused button may unmount without a blur) — so resume the remaining toasts.
  if (paused) resumeToasts();
}

/** Show a toast. Returns its id (for dismissToast). */
export function toast(message: string, opts: ToastOptions = {}) {
  const id = nextId++;
  const item = { id, message, ...opts };
  for (const old of items.slice(0, -2)) dismissToast(old.id);
  items = [...items, item];
  emit();
  arm(item);
  return id;
}

/** Hover / keyboard focus holds every toast open (WCAG 2.2.1); leaving restarts their timers. */
function pauseToasts() {
  paused = true;
  timers.forEach(clearTimeout);
  timers.clear();
}
function resumeToasts() {
  paused = false;
  items.forEach(arm);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const icons = { neutral: Info, success: CircleCheck, danger: CircleAlert };

export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  // Re-pick the portal host when a Sheet closes (the "close" event doesn't bubble, so capture it).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    document.addEventListener("close", rerender, true);
    return () => document.removeEventListener("close", rerender, true);
  }, []);
  if (list.length === 0) return null;
  // A modal <dialog> makes everything outside it inert and sits in the top layer, so while a Sheet
  // is open, render toasts inside it (so Undo stays clickable and visible).
  const dialogs = document.querySelectorAll("dialog[open]");
  const host = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  const inDialog = host !== document.body;
  return createPortal(
    <div
      onMouseEnter={pauseToasts}
      onMouseLeave={resumeToasts}
      onFocus={pauseToasts}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeToasts();
      }}
      data-app-chrome
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4",
        // Inside a sheet, sit at the top so the sheet's own footer buttons stay visible.
        inDialog ? "top-[calc(env(safe-area-inset-top)+12px)]" : "bottom-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+12px)] md:bottom-6",
      )}
    >
      {list.map((t) => {
        const tone = t.tone ?? "neutral";
        const Icon = icons[tone];
        return (
          <div
            key={t.id}
            role={tone === "danger" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-2xl bg-ink py-2.5 pl-4 pr-2 text-[15px] text-bg shadow-overlay"
          >
            <Icon className={cn("size-5 shrink-0", tone === "neutral" && "opacity-70")} aria-hidden />
            <p className="min-w-0 flex-1 py-1 font-medium">{t.message}</p>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
                className="min-h-11 rounded-full bg-bg/15 px-3.5 text-sm font-semibold hover:bg-bg/25"
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full opacity-60 hover:bg-bg/15 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>,
    host,
  );
}

/** Fire a toast once when this renders — use from server components after a redirect. */
export function FlashToast({ message, tone = "success" }: { message: string; tone?: ToastTone }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast(message, { tone });
  }, [message, tone]);
  return null;
}
