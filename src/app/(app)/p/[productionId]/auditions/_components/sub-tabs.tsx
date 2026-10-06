import { NavTabs } from "@/components/tabs";

/** Second-level tabs for an audition's sub-views (underline style under the production pills). */
export function SubTabs({ base, tabs }: { base: string; tabs: { slug: string; label: string; count?: number }[] }) {
  return (
    <NavTabs
      variant="underline"
      aria-label="Audition sections"
      className="mb-5 print:hidden"
      tabs={tabs.map((t) => ({ href: `${base}/${t.slug}`, label: t.label, count: t.count }))}
    />
  );
}
