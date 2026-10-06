"use client";

import { CalendarPlus } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Card, buttonClass } from "@/components/ui";

export type PlatformOption = {
  key: "apple" | "google" | "outlook";
  title: string;
  href: string;
  button: string;
  steps: string[];
  alt?: { label: string; href: string };
};

type Detected = PlatformOption["key"] | null;

function detect(): Detected {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) return "apple";
  if (/Android|CrOS/i.test(ua)) return "google";
  if (/Windows/i.test(ua)) return "outlook";
  return null;
}
const subscribe = () => () => {};

/** Subscribe options with the visitor's own platform first and highlighted. */
export function PlatformOptions({ options }: { options: PlatformOption[] }) {
  // Server render has no user agent: keep the default order, then reorder on the client.
  const mine = useSyncExternalStore(subscribe, detect, () => null);
  const ordered = mine ? [...options].sort((a, b) => Number(b.key === mine) - Number(a.key === mine)) : options;
  return (
    <div className="space-y-3">
      {ordered.map((o) => {
        const primary = mine ? o.key === mine : o.key === options[0].key;
        return (
          <Card key={o.key} className="space-y-3">
            <h3 className="font-display text-lg font-semibold">{o.title}</h3>
            <a
              href={o.href}
              className={buttonClass(primary ? "primary" : "secondary", "w-full sm:w-auto")}
              target={o.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
            >
              <CalendarPlus className="size-4" aria-hidden />
              {o.button}
            </a>
            <ol className="list-decimal space-y-1 pl-5 text-base text-muted">
              {o.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {o.alt ? (
              <p className="text-sm text-muted">
                <a className="inline-flex min-h-11 items-center font-medium text-accent underline" href={o.alt.href} target="_blank" rel="noreferrer">
                  {o.alt.label}
                </a>
              </p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
