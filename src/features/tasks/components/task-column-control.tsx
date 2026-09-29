"use client"

import { useEffect, useOptimistic, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { StatusDot } from "@/components/status-badge"
import { moveTaskAction, type MoveTaskState } from "../actions"
import { taskErrorMessage } from "../errors"
import {
  TASK_COLUMN_FAMILIES,
  TASK_COLUMN_LABELS,
  type TaskColumn,
} from "../status"
import { MoveToSelect } from "./move-to-select"

/**
 * The task's column as a status dot with its label, plus a "Move to…" select
 * listing exactly `allowedMoves` (task_capabilities' answer for this viewer)
 * when there are any. A move shows at once and rolls back, with a toast and
 * a refresh, if the database refuses it; the status is a polite live region,
 * so a screen reader hears both.
 *
 * While a move is saving the select stays focusable (`aria-disabled`, not
 * `disabled`, which would drop focus to the page) and ignores input. If the
 * select goes away with focus on it (a move that leaves no further moves),
 * focus goes to the status instead.
 */
export function TaskColumnControl({
  taskId,
  column,
  allowedMoves,
}: {
  taskId: string
  column: TaskColumn
  allowedMoves: readonly TaskColumn[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [shownColumn, setShownColumn] = useOptimistic(column)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const hasMoves = allowedMoves.length > 0
  const hadMoves = useRef(hasMoves)

  useEffect(() => {
    const lostFocus =
      document.activeElement === null ||
      document.activeElement === document.body
    if (hadMoves.current && !hasMoves && lostFocus) {
      statusRef.current?.focus()
    }
    hadMoves.current = hasMoves
  }, [hasMoves])

  function move(toColumn: TaskColumn) {
    if (isPending) return
    startTransition(async () => {
      setShownColumn(toColumn)
      let result: MoveTaskState
      try {
        result = await moveTaskAction({ taskId, toColumn })
      } catch {
        toast.error(taskErrorMessage("tasks.save_failed"))
        router.refresh()
        return
      }
      if (!result.ok) {
        toast.error(taskErrorMessage(result.code))
        router.refresh()
      }
    })
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
      <p
        ref={statusRef}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center rounded-sm font-medium outline-offset-4 focus-visible:outline-2"
      >
        <span className="sr-only">Status: </span>
        <StatusDot
          family={TASK_COLUMN_FAMILIES[shownColumn]}
          label={TASK_COLUMN_LABELS[shownColumn]}
        />
      </p>
      {hasMoves && (
        <MoveToSelect
          allowedMoves={allowedMoves}
          pending={isPending}
          onMove={move}
        />
      )}
    </div>
  )
}
