"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { HEADER_FOCUS } from "@/components/app-header"
import { cn } from "@/lib/utils"

import { parseDashboardView, type DashboardView } from "./dashboard-views"

// What's mine · Board · Planner. Imports nothing from @/features, so the
// header stays light.
const TABS: { label: string; href: string; view: DashboardView }[] = [
  { label: "What's mine", href: "/dashboard", view: "whats-mine" },
  { label: "Board", href: "/dashboard?view=board", view: "board" },
  { label: "Planner", href: "/dashboard?view=planner", view: "planner" },
]

/**
 * The header's view tabs (EXPERIENCE.md › Navigation; the What's mine
 * mockup). A client component only for `usePathname` and
 * `useSearchParams`. Each tab is 14px semibold, centred in a third of the
 * row. The current tab is full white with a straight 3px white underline
 * (only its top corners are rounded, for the focus outline); the rest are
 * white at 72%. It is the one whose view `/dashboard` is showing, read as the
 * page reads it (a repeated `view` is What's mine); on a task's page no tab
 * is current.
 */
export function DashboardTabs() {
  const pathname = usePathname()
  const views = useSearchParams().getAll("view")
  const view = parseDashboardView(views.length === 1 ? views[0] : views)

  return (
    <nav aria-label="Dashboard views" className="grid grid-cols-3 gap-1">
      {TABS.map((tab) => {
        const current = pathname === "/dashboard" && view === tab.view
        return (
          <Link
            key={tab.view}
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
