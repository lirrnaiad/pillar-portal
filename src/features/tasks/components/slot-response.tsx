"use client"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { respondToSlotAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { HandBackForm } from "./hand-back-form"
import { PENDING_STYLE } from "./pending-style"
import { useHandBackPanel } from "./use-hand-back-panel"

const SUCCESS_COPY = {
  on_it: "You're on it.",
  needs_reassignment: "Handed back — your head will reassign it.",
} as const

type Response = keyof typeof SUCCESS_COPY

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
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const {
    open,
    reason,
    setReason,
    rootRef,
    reasonRef,
    triggerRef,
    panelId,
    openPanel,
    cancel,
  } = useHandBackPanel({ rowId, pending: isPending })

  function respond(response: Response) {
    run(
      () =>
        respondToSlotAction({
          slotId,
          response,
          reason: response === "needs_reassignment" ? reason : null,
        }),
      {
        onSuccess: () => {
          document.getElementById(rowId)?.focus()
          toast.success(SUCCESS_COPY[response])
        },
      }
    )
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
          ref={triggerRef}
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={isPending || undefined}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={openPanel}
        >
          Can&apos;t take this<span className="sr-only"> ({slotLabel})</span>
        </Button>
      </div>

      {open && (
        <HandBackForm
          id={panelId}
          reason={reason}
          onReasonChange={setReason}
          onSubmit={() => respond("needs_reassignment")}
          onCancel={cancel}
          pending={isPending}
          reasonRef={reasonRef}
        />
      )}
    </div>
  )
}
