import { Skeleton, SkeletonCard } from "@/components/ui";

/** Generic page skeleton for the signed-in shell (title, a hero card, a list). */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="animate-fade-in">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-2 h-4 w-28" />
      <Skeleton className="mb-6 h-9 w-56" />
      <Skeleton rounded="2xl" className="mb-6 h-40 w-full" />
      <Skeleton className="mb-3 h-3.5 w-24" />
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
