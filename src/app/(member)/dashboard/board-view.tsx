import { Suspense } from "react"

import { getMyHomeScope } from "@/features/members"
import {
  BoardOwnerFilter,
  getBoardOwners,
  ownerFilterParam,
  parseOwnerFilterParam,
  TaskChangesRefresher,
  type OwnerFilter,
} from "@/features/tasks"

import { BoardColumnsSkeleton } from "./board-skeleton"
import { BoardColumns } from "./board-columns"

// The Board (EXPERIENCE.md › Board column). The owner filter is the `owner`
// parameter, or the viewer's home scope when it is missing or not a filter
// (parseOwnerFilterParam decides). The home scope goes through the same check,
// so one naming no listed section or desk falls back to All rather than
// leaving the filter blank. The filter and the live refresher sit
// outside the columns' Suspense boundary, so choosing another owner keeps the
// control mounted and focused while the columns show their skeleton, and an
// empty filtered Board still updates live. `data-wide-view` widens the shell.
export async function BoardView({ owner }: { owner: unknown }) {
  const owners = await getBoardOwners()
  const filter: OwnerFilter = parseOwnerFilterParam(owner, owners) ??
    parseOwnerFilterParam(ownerFilterParam(await getMyHomeScope()), owners) ?? {
      kind: "all",
    }
  const param = ownerFilterParam(filter)

  return (
    <div data-wide-view>
      <h1 className="font-heading text-display text-navy">Board</h1>
      <div className="mt-4">
        <BoardOwnerFilter owners={owners} value={param} />
      </div>
      <TaskChangesRefresher />
      <div className="mt-4">
        <Suspense key={param} fallback={<BoardColumnsSkeleton />}>
          <BoardColumns filter={filter} owners={owners} />
        </Suspense>
      </div>
    </div>
  )
}
