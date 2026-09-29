"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { HEADER_FOCUS } from "@/components/app-header"
import { cn } from "@/lib/utils"

// Only What's mine exists so far; Board and Planner join in Stories 1.8 and
// 1.9. Imports nothing from @/features, so the header stays light.
const TABS = [{ label: "What's mine", href: "/dashboard" }]

/**
 * The header's view tabs (EXPERIENCE.md › Navigation; the What's mine
 * mockup). A client component only for `usePathname`. Each tab is 14px
 * semibold, centred in a third of the row, so What's mine keeps its place
 * when Board and Planner arrive. The current tab is full white with a
 * straight 3px white underline (only its top corners are rounded, for the
 * focus outline); the rest are white at 72%. On a task's page the tab is
 * present but not current.
 */
export function DashboardTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="Dashboard views" className="grid grid-cols-3 gap-1">
      {TABS.map((tab) => {
        const current = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-t-sm border-b-3 border-transparent px-1 text-sm font-semibold text-white/72 hover:text-white",
              current && "border-white text-white",
              HEADER_FOCUS
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
