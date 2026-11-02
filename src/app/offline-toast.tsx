"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

const OFFLINE_COPY = "You're offline. Changes won't save until you reconnect."

/**
 * Toasts EXPERIENCE.md's offline line when the connection drops, once per
 * drop: after it shows, nothing more until the browser fires `online`. It
 * never toasts on mount (a page opened offline gets no toast), and it never
 * queues or retries a write: a save made offline fails, shows "Couldn't
 * save — try again." and rolls back, as any failed save does (no offline
 * writes). Mounted once in each of the member and admin layouts, beside
 * NoticeToast.
 */
export function OfflineToast() {
  const shown = useRef(false)

  useEffect(() => {
    function handleOffline() {
      if (shown.current) return
      shown.current = true
      toast(OFFLINE_COPY, { id: "offline" })
    }
    function handleOnline() {
      shown.current = false
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)
    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [])

  return null
}
