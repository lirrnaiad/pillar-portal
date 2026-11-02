import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import { slotRespondSchema } from "../schemas"

/**
 * The inline hand-back panel's state and focus, shared by Can't take this
 * (`SlotResponse`) and Hand back (`HandBack`): the trigger opens the panel
 * with focus in the reason (or, already open, moves focus back there), Cancel
 * clears the reason and its error and returns focus to the trigger, and both
 * ignore calls while `pending`. `checkReason` parses the reason as the
 * action will (`slotRespondSchema.shape.reason`, which hand-back reuses): a
 * refused one shows its message under the input, keeps focus there, and
 * returns false, so the caller sends nothing; typing clears the message.
 * `rowId` is the slot's row, an element with `tabIndex={-1}`, where focus
 * goes when the component goes away.
 */
export function useHandBackPanel({
  rowId,
  pending,
}: {
  rowId: string
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReasonValue] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (open) reasonRef.current?.focus()
  }, [open])

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

  function openPanel() {
    if (pending) return
    if (open) {
      reasonRef.current?.focus()
      return
    }
    setOpen(true)
  }

  function cancel() {
    if (pending) return
    setOpen(false)
    setReasonValue("")
    setReasonError(null)
    triggerRef.current?.focus()
  }

  function setReason(next: string) {
    setReasonValue(next)
    setReasonError(null)
  }

  function checkReason() {
    const parsed = slotRespondSchema.shape.reason.safeParse(reason)
    if (parsed.success) {
      setReasonError(null)
      return true
    }
    setReasonError(parsed.error.issues[0]?.message ?? null)
    reasonRef.current?.focus()
    return false
  }

  return {
    open,
    reason,
    setReason,
    reasonError,
    checkReason,
    rootRef,
    reasonRef,
    triggerRef,
    panelId,
    openPanel,
    cancel,
  }
}
