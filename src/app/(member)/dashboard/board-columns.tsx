import Link from "next/link"

import {
  boardEmptyMessage,
  getBoard,
  TaskBoard,
  type OwnerFilter,
  type TaskOwnerOption,
} from "@/features/tasks"

// The filter's tasks as the Board's columns, or, when a section, desk or
// "all articles" filter has none, a line saying so with a way out. All shows
// its four (empty) columns instead. Loads under its own Suspense boundary, so
// changing the filter keeps the filter control mounted while this reloads.
export async function BoardColumns({
  filter,
  owners,
}: {
  filter: OwnerFilter
  owners: TaskOwnerOption[]
}) {
  const cards = await getBoard(filter)
  const emptyMessage = boardEmptyMessage(filter, owners)

  if (cards.length === 0 && emptyMessage) {
    return (
      <div className="text-muted-foreground">
        <h2 className="text-heading-sm">{emptyMessage}</h2>
        <Link
          href="/dashboard?view=board&owner=all"
          className="mt-1 inline-flex min-h-11 items-center rounded-sm text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          Show all
        </Link>
      </div>
    )
  }

  return <TaskBoard cards={cards} />
}
