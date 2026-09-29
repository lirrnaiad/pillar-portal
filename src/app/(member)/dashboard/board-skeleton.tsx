import { Skeleton } from "@/components/ui/skeleton"
import { BOARD_ROW_HEIGHT } from "@/features/tasks"
import { cn } from "@/lib/utils"

// The four column blocks at the Board's real widths (w-72 below lg, sharing
// the width from lg), in the same bleeding, sideways-scrolling row, so a
// phone shows one column and a peek of the next.
export function BoardColumnsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "-mx-page-margin-mobile flex gap-column-gap overflow-hidden px-page-margin-mobile md:-mx-page-margin-desktop md:px-page-margin-desktop lg:mx-0 lg:px-0",
        BOARD_ROW_HEIGHT
      )}
    >
      <span className="sr-only">Loading the board</span>
      {[0, 1, 2, 3].map((n) => (
        <div
          key={n}
          className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted p-3 lg:w-auto lg:min-w-0 lg:flex-1"
        >
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}

// The whole Board in outline: the h1, the filter, then the columns.
// `data-wide-view` widens the shell as soon as this shows, so the width
// doesn't jump when the Board arrives.
export function BoardSkeleton() {
  return (
    <div data-wide-view>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-4 h-11 w-full sm:max-w-xs" />
      <div className="mt-4">
        <BoardColumnsSkeleton />
      </div>
    </div>
  )
}
