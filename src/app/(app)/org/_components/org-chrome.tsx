import { NavTabs } from "@/components/tabs";
import { Chip } from "@/components/ui";
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
  path = "/org",
}: {
  org: Org;
  orgs: Org[];
  /** Kept for call-site compatibility; the active tab now follows the URL. */
  active: (typeof TABS)[number]["key"];
  path?: string;
}) {
  return (
    <div className="mb-6 space-y-3">
      {orgs.length > 1 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
          {orgs.map((o) => (
            <Chip key={o.id} href={`${path}?org=${o.id}`} active={o.id === org.id}>
              {o.name}
            </Chip>
          ))}
        </div>
      ) : null}
      <NavTabs
        aria-label="Company sections"
        exact="/org"
        tabs={TABS.map((t) => ({ href: `${t.path}?org=${org.id}`, label: t.label }))}
      />
    </div>
  );
}
