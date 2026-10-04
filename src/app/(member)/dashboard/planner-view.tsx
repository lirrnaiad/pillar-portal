import { Suspense } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { getMyHomeScope } from "@/features/members"
import {
  getBoardOwners,
  ownerFilterParam,
  parseIncludeScope,
  parseOwnerFilterParam,
  plannerHref,
  plannerScopeLabel,
  PlannerScopeToggle,
  type PlannerScope,
} from "@/features/tasks"
import {
  monthWeeks,
  parsePhtMonth,
  phtDayKey,
  phtMonthLabel,
  phtMonthOf,
  shiftMonth,
} from "@/lib/time"
import { cn } from "@/lib/utils"

import { PlannerMonth } from "./planner-month"
import { PlannerMonthSkeleton } from "./planner-skeleton"

const HEADING_ID = "planner-month-heading"

const CONTROL = cn(buttonVariants({ variant: "outline" }), "h-11")

// The Planner (EXPERIENCE.md › Planner): one Manila month of the viewer's
// open-slot tasks. The month is the `month` parameter, or the current Manila
// month when it is missing or malformed. The toggle exists only when the
// viewer's home scope, put through the Board's owner check, names a desk, a
// section or all articles; it is on only while `scope=home` and it exists.
// The month heading, its controls and the toggle sit outside the month's
// keyed Suspense boundary, so they stay mounted and keep focus while the
// month loads; the heading is a polite live region, so the month a control
// moved to is announced. Previous or Next is left out at the edge of the
// months `parsePhtMonth` accepts (1000-01, 9999-12) rather than linking to a
// month that would fall back to the current one. `data-wide-view` widens the
// shell.
export async function PlannerView({
  month,
  scope,
}: {
  month: unknown
  scope: unknown
}) {
  const now = new Date()
  const shown = parsePhtMonth(month) ?? phtMonthOf(now)
  const today = phtDayKey(now)
  const previous = parsePhtMonth(shiftMonth(shown, -1))
  const next = parsePhtMonth(shiftMonth(shown, 1))

  const [owners, homeScope] = await Promise.all([
    getBoardOwners(),
    getMyHomeScope(),
  ])
  const home = parseOwnerFilterParam(ownerFilterParam(homeScope), owners)
  const toggleScope: PlannerScope | null =
    home && home.kind !== "all" ? home : null
  const includeScope = toggleScope !== null && parseIncludeScope(scope)

  return (
    <div data-wide-view>
      <h1 className="font-heading text-display text-navy">Planner</h1>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={HEADING_ID} aria-live="polite" className="text-heading">
          {phtMonthLabel(shown)}
        </h2>
        <nav aria-label="Months" className="flex items-center gap-2">
          {previous && (
            <Link
              href={plannerHref({ month: previous, includeScope })}
              aria-label="Previous month"
              className={cn(CONTROL, "w-11")}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
          )}
          <Link
            href={plannerHref({ includeScope })}
            className={cn(CONTROL, "px-4")}
          >
            Today
          </Link>
          {next && (
            <Link
              href={plannerHref({ month: next, includeScope })}
              aria-label="Next month"
              className={cn(CONTROL, "w-11")}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
        </nav>
      </div>
      {toggleScope && (
        <div className="mt-2">
          <PlannerScopeToggle
            label={plannerScopeLabel(toggleScope, owners)}
            checked={includeScope}
            month={shown}
          />
        </div>
      )}
      <div className="mt-4">
        <Suspense
          key={`${shown}:${includeScope ? "home" : "mine"}`}
          fallback={<PlannerMonthSkeleton weeks={monthWeeks(shown).length} />}
        >
          <PlannerMonth
            month={shown}
            scope={includeScope ? toggleScope : null}
            today={today}
            headingId={HEADING_ID}
          />
        </Suspense>
      </div>
    </div>
  )
}
