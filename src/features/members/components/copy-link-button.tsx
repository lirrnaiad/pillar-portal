"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"

import { IN_APP_COPY } from "../in-app-browser"

/**
 * The in-app browser page's secondary Copy link. Success is announced in a
 * polite live region that is always in the DOM; where the clipboard is out
 * of reach, a read-only "Link to copy" field appears instead, focused with
 * the link selected.
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const [failures, setFailures] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (failures === 0) return
    field.current?.focus()
    field.current?.select()
  }, [failures])

  async function copy() {
    // Cleared first, so a second copy is announced again.
    setCopied(false)
    if (await copyText(url)) {
      // The field can hold focus; give it back to the button as it goes.
      if (manual) button.current?.focus()
      setManual(false)
      setCopied(true)
    } else {
      setManual(true)
      setFailures((n) => n + 1)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        ref={button}
        type="button"
        variant="outline"
        onClick={copy}
        className="min-h-11 w-full text-base"
      >
        {IN_APP_COPY.copyLink}
      </Button>
      <p aria-live="polite" className="text-sm">
        {copied ? IN_APP_COPY.copied : null}
      </p>
      {manual && (
        <div className="flex flex-col gap-1">
          <label htmlFor="login-link" className="text-sm font-medium">
            {IN_APP_COPY.linkToCopy}
          </label>
          <input
            ref={field}
            id="login-link"
            type="text"
            readOnly
            value={url}
            className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
      )}
    </div>
  )
}
