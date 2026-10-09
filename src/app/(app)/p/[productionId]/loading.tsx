import { Skeleton } from "@/components/ui";

/** Tab-content skeleton: the production header and tab strip stay put while a tab loads. */
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading" className="animate-fade-in">
      <Skeleton className="mb-3 h-3.5 w-24" />
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton rounded="full" className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
