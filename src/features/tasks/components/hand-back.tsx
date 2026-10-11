"use client"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { handBackSlotAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { HandBackForm } from "./hand-back-form"
import { PENDING_STYLE } from "./pending-style"
import { useHandBackPanel } from "./use-hand-back-panel"

/**
 * Hand back, for one slot the viewer may hand back (the page renders this
 * only for a slot in task_capabilities' hand_back_slot_ids). A secondary
 * button opens the same inline form as Can't take this; nothing changes on
 * screen until the database has the answer, and focus moves to the slot's row
 * (`rowId`) before the page re-renders without this component.
 */
export function HandBack({
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

  function submit() {
    run(() => handBackSlotAction({ slotId, reason }), {
      onSuccess: () => {
        document.getElementById(rowId)?.focus()
        toast.success("Handed back — your head will reassign it.")
      },
    })
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className={cn("min-h-11 self-start", PENDING_STYLE)}
        aria-disabled={isPending || undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={openPanel}
      >
        Hand back<span className="sr-only"> ({slotLabel})</span>
      </Button>
      {open && (
        <HandBackForm
          id={panelId}
          reason={reason}
          onReasonChange={setReason}
          onSubmit={submit}
          onCancel={cancel}
          pending={isPending}
          reasonRef={reasonRef}
          showIntro={false}
        />
      )}
    </div>
  )
}
