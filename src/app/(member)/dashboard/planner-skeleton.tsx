import { Skeleton } from "@/components/ui/skeleton"

// The month in outline while getPlanner runs: its weeks of day cells from md
// (the grid; five unless told, since the page-level fallback can't know the
// month), a few 44px day rows below it (the day list).
export function PlannerMonthSkeleton({ weeks = 5 }: { weeks?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading the planner</span>
      <div className="hidden grid-cols-7 gap-1 md:grid">
        {Array.from({ length: weeks * 7 }, (_, n) => (
          <Skeleton key={n} className="h-28" />
        ))}
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-11 w-full" />
        ))}
      </div>
    </div>
  )
}

// The whole Planner in outline: the h1, the month heading and its controls,
// the toggle, then the month. `data-wide-view` widens the shell as soon as
// this shows, so the width doesn't jump when the Planner arrives.
// dashboard/page.tsx uses it as the Planner's Suspense fallback, so it never
// shows for another view.
export function PlannerSkeleton() {
  return (
    <div data-wide-view>
      <Skeleton className="h-9 w-40" />
      <div className="mt-4 flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-11 w-44" />
      </div>
      <Skeleton className="mt-2 h-11 w-40" />
      <div className="mt-4">
        <PlannerMonthSkeleton />
      </div>
    </div>
  )
}
