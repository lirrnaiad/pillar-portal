"use client"

import { useEffect, useOptimistic, useRef } from "react"

import { StatusDot } from "@/components/status-badge"
import { useCommand } from "@/lib/use-command"

import { moveTaskAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { taskStatus, type TaskColumn } from "../status"
import { MoveToSelect } from "./move-to-select"
import { TASK_STATUS_ID } from "./task-status-id"

/**
 * The task's column as a status dot with its label, plus a "Move to…" select
 * listing exactly `allowedMoves` (task_capabilities' answer for this viewer)
 * when there are any. A move shows at once and rolls back, with a toast and
 * a refresh, if the database refuses it; the status is a polite live region,
 * so a screen reader hears both. A sent-back task reads "Sent back" until a
 * move is shown: every move clears the note.
 *
 * The status is `#task-status` (TASK_STATUS_ID), where the review controls
 * put focus once their command is saved.
 *
 * While a move is saving the select stays focusable (`aria-disabled`, not
 * `disabled`, which would drop focus to the page) and ignores input. If the
 * select goes away with focus on it (a move that leaves no further moves),
 * focus goes to the status instead.
 */
export function TaskColumnControl({
  taskId,
  column,
  sentBack,
  allowedMoves,
}: {
  taskId: string
  column: TaskColumn
  /** The task's revision note stands (task detail's revisionNote). */
  sentBack: boolean
  allowedMoves: readonly TaskColumn[]
}) {
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const [shownColumn, setShownColumn] = useOptimistic(column)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const status = taskStatus(shownColumn, sentBack && shownColumn === column)
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
    run(() => {
      setShownColumn(toColumn)
      return moveTaskAction({ taskId, toColumn })
    })
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
      <p
        ref={statusRef}
        id={TASK_STATUS_ID}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center rounded-sm font-medium outline-offset-4 focus-visible:outline-2"
      >
        <span className="sr-only">Status: </span>
        <StatusDot family={status.family} label={status.label} />
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
