import Link from "next/link";
import { cn } from "@/components/ui";
import type { Org } from "../_lib/org";

const TABS = [
  { key: "dashboard", label: "Overview", path: "/org" },
  { key: "people", label: "People", path: "/org/people" },
  { key: "members", label: "Members", path: "/org/members" },
  { key: "api-keys", label: "API keys", path: "/org/api-keys" },
] as const;

/** Org switcher (only when the user admins several orgs) + Company section tabs. */
export function OrgChrome({
  org,
  orgs,
  active,
  path = "/org",
}: {
  org: Org;
  orgs: Org[];
  active: (typeof TABS)[number]["key"];
  path?: string;
}) {
  return (
    <div className="mb-5 space-y-3">
      {orgs.length > 1 ? (
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex w-max gap-2">
            {orgs.map((o) => (
              <Link
                key={o.id}
                href={`${path}?org=${o.id}`}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium",
                  o.id === org.id ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-muted hover:text-ink",
                )}
              >
                {o.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <nav className="-mx-4 overflow-x-auto border-b border-line px-4">
        <ul className="flex w-max gap-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`${t.path}?org=${org.id}`}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium",
                  t.key === active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
