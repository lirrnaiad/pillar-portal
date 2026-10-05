"use client"

import { useEffect, useRef, useState } from "react"
import { MessageSquareShare } from "lucide-react"
import { toast } from "sonner"

import { copyText, MESSENGER_COPIED, MESSENGER_HINT } from "../messenger"

/**
 * Task detail's Copy for Messenger. Where the clipboard is out of reach
 * (some in-app browsers) the message appears in a selected text box instead.
 */
export function CopyForMessenger({ message }: { message: string }) {
  const [manual, setManual] = useState(false)
  const [failures, setFailures] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (failures === 0) return
    box.current?.focus()
    box.current?.select()
  }, [failures])

  async function copy() {
    if (await copyText(message)) {
      // The box can hold focus; give it back to the button as it goes.
      if (manual) button.current?.focus()
      setManual(false)
      toast.success(MESSENGER_COPIED)
    } else {
      setManual(true)
      setFailures((n) => n + 1)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        ref={button}
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-input bg-background px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <MessageSquareShare aria-hidden className="size-4" />
        Copy for Messenger
      </button>
      {manual && (
        <div className="flex flex-col gap-1">
          <label htmlFor="messenger-message" className="sr-only">
            Message to copy
          </label>
          <textarea
            ref={box}
            id="messenger-message"
            readOnly
            rows={3}
            value={message}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
          <p className="text-sm text-muted-foreground">{MESSENGER_HINT}</p>
        </div>
      )}
    </div>
  )
}
