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
import { cn } from "@/lib/utils"

import { handBackSlotAction, type HandBackSlotState } from "../actions"
import { taskErrorMessage } from "../errors"
import { HandBackForm, PENDING_STYLE } from "./hand-back-form"
import { refreshAfterFailure } from "./refresh-after-failure"

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
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (open) reasonRef.current?.focus()
  }, [open])

  // However this goes away, focus inside it moves to the slot's row rather
  // than falling to the page.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement)) {
        document.getElementById(rowId)?.focus()
      }
    }
  }, [rowId])

  function submit() {
    if (isPending) return
    startTransition(async () => {
      let result: HandBackSlotState
      try {
        result = await handBackSlotAction({ slotId, reason })
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
      toast.success("Handed back — your head will reassign it.")
    })
  }

  function cancel() {
    if (isPending) return
    setOpen(false)
    setReason("")
    triggerRef.current?.focus()
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
        onClick={() => {
          if (isPending) return
          if (open) reasonRef.current?.focus()
          else setOpen(true)
        }}
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
