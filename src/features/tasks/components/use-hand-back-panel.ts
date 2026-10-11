import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"

/**
 * The inline hand-back panel's state and focus, shared by Can't take this
 * (`SlotResponse`) and Hand back (`HandBack`): the trigger opens the panel
 * with focus in the reason (or, already open, moves focus back there), Cancel
 * clears the reason and returns focus to the trigger, and both ignore calls
 * while `pending`. `rowId` is the slot's row, an element with
 * `tabIndex={-1}`, where focus goes when the component goes away.
 */
export function useHandBackPanel({
  rowId,
  pending,
}: {
  rowId: string
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
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
    setReason("")
    triggerRef.current?.focus()
  }

  return {
    open,
    reason,
    setReason,
    rootRef,
    reasonRef,
    triggerRef,
    panelId,
    openPanel,
    cancel,
  }
}
