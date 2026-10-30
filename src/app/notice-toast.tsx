"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

type Notice = {
  /**
   * The only page that shows it. On any other path the param is stripped
   * and nothing is shown, so a crafted link can't claim a delete elsewhere.
   */
  pathname: string
  text: string
  /** `success` for a command's own confirmation, `default` otherwise. */
  tone: "default" | "success"
  /** Whether focus moves to the page's h1 (`main h1[tabindex="-1"]`). */
  focusHeading: boolean
}

// Keyed by the `?notice=` value a redirect or a command's navigation sets:
// requireAdmin's, sending a staff member who opens /admin to /dashboard
// (spec-1-5-admin-task-creation.md's Design Notes), and Task detail's Delete,
// which lands on /admin/tasks.
const NOTICES: Record<string, Notice> = {
  "admin-restricted": {
    pathname: "/dashboard",
    text: "That area is for the Editorial Board.",
    tone: "default",
    focusHeading: false,
  },
  "task-deleted": {
    pathname: "/admin/tasks",
    text: "Task deleted.",
    tone: "success",
    focusHeading: true,
  },
}

/**
 * Reads `?notice=` once, toasts its copy if it is recognized and this is its
 * page (and, for a notice that asks, focuses the page's h1), then strips the
 * param via `router.replace` so reloading or sharing the URL doesn't re-fire
 * it. Each toast has a stable id (`notice-<key>`), so a second run of the
 * effect (StrictMode runs it twice in dev) still shows one. Mounted once in
 * each of the member and admin layouts, inside a Suspense boundary
 * (`useSearchParams` requires one).
 */
export function NoticeToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const notice = searchParams.get("notice")

  useEffect(() => {
    if (!notice) return

    const entry = Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : undefined
    if (entry && entry.pathname === pathname) {
      const options = { id: `notice-${notice}` }
      if (entry.tone === "success") toast.success(entry.text, options)
      else toast(entry.text, options)
      if (entry.focusHeading) {
        document.querySelector<HTMLElement>('main h1[tabindex="-1"]')?.focus()
      }
    }

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
