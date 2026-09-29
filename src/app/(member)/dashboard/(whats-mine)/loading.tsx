import { Skeleton } from "@/components/ui/skeleton"

// What's mine's layout in outline while getWhatsMine runs: the h1, a section
// heading with two cards and their button rows, then a heading and three
// cards. It sits in the (whats-mine) group so it never shows for Task detail.
export default function WhatsMineLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading your tasks</span>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="mt-6 h-5 w-40" />
      <div className="mt-3 flex flex-col gap-3">
        {[0, 1].map((n) => (
          <div key={n} className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-8 h-5 w-32" />
      <div className="mt-3 flex flex-col gap-3">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-24 w-full" />
        ))}
      </div>
    </div>
  )
}
