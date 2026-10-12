import { Suspense } from "react"
import type { Metadata } from "next"

import { requireActiveMember } from "@/features/members"

import { BoardSkeleton } from "./board-skeleton"
import { BoardView } from "./board-view"
import { DASHBOARD_VIEW_TITLES, parseDashboardView } from "../dashboard-views"
import { PlannerSkeleton } from "./planner-skeleton"
import { PlannerView } from "./planner-view"
import { WhatsMineSkeleton } from "./whats-mine-skeleton"
import { WhatsMineView } from "./whats-mine-view"

export async function generateMetadata({
  searchParams,
}: PageProps<"/dashboard">): Promise<Metadata> {
  const { view } = await searchParams
  return { title: DASHBOARD_VIEW_TITLES[parseDashboardView(view)] }
}

// One route, three views (`?view=board` selects the Board, `?view=planner`
// the Planner). `loading.tsx` can't read search params and would show What's
// mine's skeleton on every switch to another view, and a
// `dashboard/loading.tsx` would also flash it on every task link, so this
// page owns every loading state. The keyed Suspense boundaries show each
// view's own skeleton on a switch.
//
// The state check comes first, before any Suspense: a redirect thrown inside
// a streamed boundary would arrive as a client-side meta refresh.
export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  await requireActiveMember()
  const { view, owner, month, scope } = await searchParams

  switch (parseDashboardView(view)) {
    case "board":
      return (
        <Suspense key="board" fallback={<BoardSkeleton />}>
          <BoardView owner={owner} />
        </Suspense>
      )
    case "planner":
      return (
        <Suspense key="planner" fallback={<PlannerSkeleton />}>
          <PlannerView month={month} scope={scope} />
        </Suspense>
      )
    case "whats-mine":
      return (
        <Suspense key="whats-mine" fallback={<WhatsMineSkeleton />}>
          <WhatsMineView />
        </Suspense>
      )
  }
}
