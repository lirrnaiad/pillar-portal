import { Suspense } from "react"
import type { Metadata } from "next"

import { BoardSkeleton } from "./board-skeleton"
import { BoardView } from "./board-view"
import { DASHBOARD_VIEW_TITLES, parseDashboardView } from "../dashboard-views"
import { WhatsMineSkeleton } from "./whats-mine-skeleton"
import { WhatsMineView } from "./whats-mine-view"

export async function generateMetadata({
  searchParams,
}: PageProps<"/dashboard">): Promise<Metadata> {
  const { view } = await searchParams
  return { title: DASHBOARD_VIEW_TITLES[parseDashboardView(view)] }
}

// One route, two views (`?view=board` selects the Board). `loading.tsx`
// can't read search params and would show What's mine's skeleton on every
// switch to the Board, and a `dashboard/loading.tsx` would also flash it on
// every task link, so this page owns both loading states. The keyed Suspense
// boundaries show each view's own skeleton on a switch.
export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const { view, owner } = await searchParams

  return parseDashboardView(view) === "board" ? (
    <Suspense key="board" fallback={<BoardSkeleton />}>
      <BoardView owner={owner} />
    </Suspense>
  ) : (
    <Suspense key="whats-mine" fallback={<WhatsMineSkeleton />}>
      <WhatsMineView />
    </Suspense>
  )
}
