"use client"

import { useId, type Ref } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export const REASON_MAX = 280

// Shown while an answer is saving. The controls stay focusable
// (`aria-disabled`, not `disabled`, which would drop focus to the page) and
// ignore input instead.
export const PENDING_STYLE =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50"

/**
 * The inline hand-back form shared by Can't take this (an awaiting slot) and
 * Hand back (an On it slot): the copy, an optional reason, Hand it back and
 * Cancel. Enter submits, Escape cancels. The parent owns the state and the
 * action, and moves focus.
 */
export function HandBackForm({
  id,
  reason,
  onReasonChange,
  onSubmit,
  onCancel,
  pending,
  reasonRef,
  showIntro = true,
}: {
  id?: string
  reason: string
  onReasonChange: (reason: string) => void
  onSubmit: () => void
  onCancel: () => void
  pending: boolean
  reasonRef: Ref<HTMLInputElement>
  /** Off where the page already shows the copy (Hand back). */
  showIntro?: boolean
}) {
  const reasonId = useId()
  const hintId = useId()

  return (
    <form
      id={id}
      noValidate
      className="flex flex-col gap-3 rounded-lg bg-muted p-card-padding"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      {showIntro && (
        <p>Can&apos;t take this? Hand it back — your head will reassign it.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>Reason (optional)</Label>
        <Input
          ref={reasonRef}
          id={reasonId}
          value={reason}
          maxLength={REASON_MAX}
          aria-describedby={hintId}
          aria-disabled={pending || undefined}
          readOnly={pending}
          className={cn("min-h-11 bg-card", PENDING_STYLE)}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <p id={hintId} className="text-sm text-muted-foreground">
          Only you and the task&apos;s approver see this.
        </p>
      </div>
      <div className="flex gap-3">
        <Button
          type="submit"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={pending || undefined}
        >
          Hand it back
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={pending || undefined}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
