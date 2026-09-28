"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

// Keyed by the `?notice=` value a redirect sets. Starts with the one the
// (admin) layout uses for a staff member who opens /admin
// (spec-1-5-admin-task-creation.md's Design Notes); later stories add more.
const NOTICE_COPY: Record<string, string> = {
  "admin-restricted": "That area is for the Editorial Board.",
}

/**
 * Reads `?notice=` once, toasts its copy if recognized, then strips the
 * param via `router.replace` so reloading or sharing the URL doesn't re-fire
 * it. Mounted once in the member layout, inside a Suspense boundary
 * (`useSearchParams` requires one).
 */
export function NoticeToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const notice = searchParams.get("notice")

  useEffect(() => {
    if (!notice) return

    const message = NOTICE_COPY[notice]
    if (message) toast(message)

    const params = new URLSearchParams(searchParams)
    params.delete("notice")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
    // Only `notice` (from the URL at mount) should re-trigger this: including
    // searchParams/pathname/router would re-run it after the replace above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])

  return null
}
