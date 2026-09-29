"use client"

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import { respondToSlotAction, type RespondToSlotState } from "../actions"
import { taskErrorMessage } from "../errors"
import { refreshAfterFailure } from "./refresh-after-failure"

const REASON_MAX = 280

const SUCCESS_COPY = {
  on_it: "You're on it.",
  needs_reassignment: "Handed back — your head will reassign it.",
} as const

type Response = keyof typeof SUCCESS_COPY

// Shown while an answer is saving. The controls stay focusable
// (`aria-disabled`, not `disabled`, which would drop focus to the page) and
// ignore input instead.
const PENDING_STYLE =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50"

/**
 * I'm on it / Can't take this, for one slot the viewer may answer (the page
 * renders this only for a slot in task_capabilities' respondable_slot_ids).
 * Can't take this opens an inline form for an optional reason: Enter hands
 * the slot back, Escape cancels. Nothing changes on screen until the
 * database has the answer: the page re-renders from revalidation, and this
 * component then goes away, so focus moves first to the slot's row
 * (`rowId`, an element with `tabIndex={-1}`).
 *
 * `slotLabel` (the slot's role) tells two sets of buttons apart for a
 * screen reader when the viewer holds two slots on one task.
 */
export function SlotResponse({
  slotId,
  slotLabel,
  rowId,
}: {
  slotId: string
  slotLabel: string
  rowId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [handingBack, setHandingBack] = useState(false)
  const [reason, setReason] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const cantTakeRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const reasonId = useId()
  const hintId = useId()

  useEffect(() => {
    if (handingBack) reasonRef.current?.focus()
  }, [handingBack])

  // However this goes away (a saved answer, or a refresh after a refused one
  // that shows the slot is no longer the viewer's to answer), focus inside it
  // moves to the slot's row rather than falling to the page. Layout-effect
  // cleanup runs before React removes the DOM nodes, so focus is still here.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement)) {
        document.getElementById(rowId)?.focus()
      }
    }
  }, [rowId])

  function respond(response: Response) {
    if (isPending) return
    startTransition(async () => {
      let result: RespondToSlotState
      try {
        result = await respondToSlotAction({
          slotId,
          response,
          reason: response === "needs_reassignment" ? reason : null,
        })
      } catch {
        toast.error(taskErrorMessage("tasks.save_failed"))
        refreshAfterFailure(router)
        return
      }
      if (!result.ok) {
        toast.error(taskErrorMessage(result.code))
        refreshAfterFailure(router)
        return
      }
      document.getElementById(rowId)?.focus()
      toast.success(SUCCESS_COPY[response])
    })
  }

  function openPanel() {
    if (isPending) return
    if (handingBack) {
      reasonRef.current?.focus()
      return
    }
    setHandingBack(true)
  }

  function cancel() {
    if (isPending) return
    setHandingBack(false)
    setReason("")
    cantTakeRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={isPending || undefined}
          onClick={() => respond("on_it")}
        >
          I&apos;m on it<span className="sr-only"> ({slotLabel})</span>
        </Button>
        <Button
          ref={cantTakeRef}
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={isPending || undefined}
          aria-expanded={handingBack}
          aria-controls={handingBack ? panelId : undefined}
          onClick={openPanel}
        >
          Can&apos;t take this<span className="sr-only"> ({slotLabel})</span>
        </Button>
      </div>

      {handingBack && (
        <form
          id={panelId}
          noValidate
          className="flex flex-col gap-3 rounded-lg bg-muted p-card-padding"
          onSubmit={(event) => {
            event.preventDefault()
            respond("needs_reassignment")
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              cancel()
            }
          }}
        >
          <p>
            Can&apos;t take this? Hand it back — your head will reassign it.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>Reason (optional)</Label>
            <Input
              ref={reasonRef}
              id={reasonId}
              value={reason}
              maxLength={REASON_MAX}
              aria-describedby={hintId}
              aria-disabled={isPending || undefined}
              readOnly={isPending}
              className={cn("min-h-11 bg-card", PENDING_STYLE)}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={hintId} className="text-sm text-muted-foreground">
              Only you and the task&apos;s approver see this.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              type="submit"
              className={cn("min-h-11", PENDING_STYLE)}
              aria-disabled={isPending || undefined}
            >
              Hand it back
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn("min-h-11", PENDING_STYLE)}
              aria-disabled={isPending || undefined}
              onClick={cancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
