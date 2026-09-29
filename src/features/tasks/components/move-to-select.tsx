"use client"

import { useState, type Ref } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { TASK_COLUMN_LABELS, type TaskColumn } from "../status"

export const MOVE_LABEL = "Move to…"

/**
 * The "Move to…" select: a command listing exactly `allowedMoves` (never
 * derived from roles or slot state, AD-4), the non-drag way to move a task
 * (WCAG 2.5.7). Controlled at "" so the trigger always reads "Move to…"
 * instead of keeping a value. While `pending` the trigger is `aria-disabled`
 * (never `disabled`, which would drop focus to the page) and ignores opening
 * and value changes.
 *
 * Radix selects the matching item when a letter is typed on a closed trigger,
 * as a native select does. Here that would make a move from one stray
 * keystroke, so letters typed on the closed trigger are dropped; Space, Enter
 * and the arrow keys still open it.
 */
export function MoveToSelect({
  allowedMoves,
  pending,
  onMove,
  label = MOVE_LABEL,
  triggerRef,
}: {
  allowedMoves: readonly TaskColumn[]
  pending: boolean
  onMove: (toColumn: TaskColumn) => void
  label?: string
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const [open, setOpen] = useState(false)

  return (
    <Select
      value=""
      open={open}
      onOpenChange={(next) => setOpen(next && !pending)}
      onValueChange={(value) => {
        if (!pending) onMove(value as TaskColumn)
      }}
    >
      <SelectTrigger
        ref={triggerRef}
        aria-label={label}
        aria-disabled={pending || undefined}
        onKeyDown={(event) => {
          // A preventDefault here skips Radix's own handler, typeahead included.
          if (event.key.length === 1 && event.key !== " ")
            event.preventDefault()
        }}
        className="min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        <SelectValue placeholder={MOVE_LABEL} />
      </SelectTrigger>
      <SelectContent>
        {allowedMoves.map((toColumn) => (
          <SelectItem key={toColumn} value={toColumn} className="min-h-11">
            {TASK_COLUMN_LABELS[toColumn]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
