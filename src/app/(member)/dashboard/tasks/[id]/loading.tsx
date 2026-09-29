import { Skeleton } from "@/components/ui/skeleton"

// Task detail's layout in outline while getTaskDetail runs: the title, the
// column, the meta rows, the Slots heading and three slot rows.
export default function TaskLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading task</span>
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="mt-3 h-11 w-32" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <Skeleton className="mt-8 h-5 w-16" />
      <div className="mt-3 flex flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}
