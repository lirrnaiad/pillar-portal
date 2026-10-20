"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

import { ADMIN_NAV_LINKS, isCurrentAdminLink } from "./admin-nav"

/**
 * The admin nav below `lg` (owner decision, 2026-10-20: visible tabs, not a
 * hamburger Sheet): a row in the header's `nav` slot, styled like the member
 * header's DashboardTabs. The tabs share the row while they fit; once they
 * don't (Reports and Recruitment make five), the row scrolls sideways, its
 * scrollbar hidden, and the current tab is scrolled fully into view on load,
 * on each navigation and whenever the row's size changes (a window shrunk
 * below `lg`, where the row was hidden and measured nothing, or a phone
 * rotated).
 *
 * The row clips its tabs vertically too, so their white focus outline sits
 * inside them (`-outline-offset-2`) rather than HEADER_FOCUS's outer offset.
 * A client component only for `usePathname`; it imports nothing from
 * @/features, so admin-shell.tsx stays a Server Component.
 */
export function AdminTabs() {
  const pathname = usePathname()
  const rowRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (rowRef.current) revealCurrentTab(rowRef.current)
  }, [pathname])

  // The row's size changes without a navigation too. The callback finds the
  // current tab when it runs, so one observer serves every pathname.
  useEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => revealCurrentTab(row))
    observer.observe(row)
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      ref={rowRef}
      aria-label="Admin areas"
      className="flex [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain lg:hidden [&::-webkit-scrollbar]:hidden"
    >
      {ADMIN_NAV_LINKS.map((link) => {
        const current = isCurrentAdminLink(pathname, link)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-1 shrink-0 items-center justify-center rounded-t-sm border-b-3 border-transparent px-3 text-sm font-semibold whitespace-nowrap text-white/72 hover:text-white",
              current && "border-white text-white",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}

// Scrolls the row just far enough that its current tab shows in full. Only
// the row's own scrollLeft moves: scrollIntoView could scroll the page as
// well.
function revealCurrentTab(row: HTMLElement) {
  const tab = row.querySelector<HTMLElement>('[aria-current="page"]')
  if (!tab) return

  const rowBox = row.getBoundingClientRect()
  const tabBox = tab.getBoundingClientRect()
  const start = tabBox.left - rowBox.left + row.scrollLeft
  const end = start + tabBox.width
  if (start < row.scrollLeft) {
    row.scrollLeft = start
  } else if (end > row.scrollLeft + row.clientWidth) {
    // A tab wider than the row shows its start.
    row.scrollLeft = Math.min(start, end - row.clientWidth)
  }
}
