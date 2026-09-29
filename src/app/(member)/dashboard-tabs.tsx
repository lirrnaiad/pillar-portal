"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { HEADER_FOCUS } from "@/components/app-header"
import { cn } from "@/lib/utils"

// Only What's mine exists so far; Board and Planner join in Stories 1.8 and
// 1.9. Imports nothing from @/features, so the header stays light.
const TABS = [{ label: "What's mine", href: "/dashboard" }]

/**
 * The header's view tabs (EXPERIENCE.md › Navigation). A client component
 * only for `usePathname`. The current tab is full white with a 3px white
 * bottom border; the rest are white at reduced opacity. On a task's page the
 * tab is present but not current.
 */
export function DashboardTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="Dashboard views" className="flex gap-4">
      {TABS.map((tab) => {
        const current = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-sm border-b-3 border-transparent px-1 text-white/75 hover:text-white",
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
