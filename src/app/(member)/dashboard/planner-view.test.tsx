// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getMyHomeScope, getBoardOwners, PlannerScopeToggle } = vi.hoisted(
  () => ({
    getMyHomeScope: vi.fn(),
    getBoardOwners: vi.fn(),
    PlannerScopeToggle: vi.fn(
      ({
        label,
        checked,
        month,
      }: {
        label: string
        checked: boolean
        month?: string
      }) => (
        <p>
          toggle {label} {checked ? "on" : "off"} month={String(month)}
        </p>
      )
    ),
  })
)

// PlannerMonth is an async Server Component, which React can't render on the
// client: stub it, and check what it is given.
const { PlannerMonth } = vi.hoisted(() => ({
  PlannerMonth: vi.fn(({ month, scope }: { month: string; scope: unknown }) => (
    <p>
      month {month} scope {JSON.stringify(scope)}
    </p>
  )),
}))

vi.mock("@/features/members", () => ({ getMyHomeScope }))
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  const planner = await vi.importActual<
    typeof import("@/features/tasks/planner")
  >("@/features/tasks/planner")
  return {
    ownerFilterParam: board.ownerFilterParam,
    parseOwnerFilterParam: board.parseOwnerFilterParam,
    parseIncludeScope: planner.parseIncludeScope,
    plannerHref: planner.plannerHref,
    plannerScopeLabel: planner.plannerScopeLabel,
    getBoardOwners,
    PlannerScopeToggle,
  }
})
vi.mock("./planner-month", () => ({ PlannerMonth }))

import {
  Suspense,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import Link from "next/link"

import { PlannerMonthSkeleton } from "./planner-skeleton"
import { PlannerView } from "./planner-view"

// The first element of `type` in a rendered tree, searched depth-first.
function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return undefined
  }
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node
  return findElement((node.props as { children?: ReactNode }).children, type)
}

const OWNERS = [
  { kind: "section", id: "news", name: "News" },
  { kind: "section", id: "feature", name: "Feature" },
  { kind: "desk", id: "layout", name: "Layout" },
]

beforeEach(() => {
  // Thu, Oct 8 2026, 10:00 AM in Manila.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-08T02:00:00Z"))
  getBoardOwners.mockResolvedValue(OWNERS)
  getMyHomeScope.mockResolvedValue({ kind: "desk", id: "layout" })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function renderView(month: unknown, scope?: unknown) {
  return render(await PlannerView({ month, scope }))
}

const monthProps = () =>
  PlannerMonth.mock.calls[0][0] as {
    month: string
    scope: unknown
    today: string
    headingId: string
  }

const hrefOf = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href")

describe("PlannerView", () => {
  it("has the serif h1 Planner, the month's h2, the controls, the toggle and the month", async () => {
    await renderView(undefined)

    expect(
      screen.getByRole("heading", { level: 1, name: "Planner" })
    ).toHaveClass("font-heading")
    // A polite live region: it stays mounted, so the month a control moved
    // to is announced.
    expect(
      screen.getByRole("heading", { level: 2, name: "October 2026" })
    ).toHaveAttribute("aria-live", "polite")
    expect(
      screen.getByRole("navigation", { name: "Months" })
    ).toBeInTheDocument()
    expect(screen.getByText(/^toggle/)).toBeInTheDocument()
    expect(screen.getByText(/^month 2026-10/)).toBeInTheDocument()
  })

  it("marks its root for the wide shell", async () => {
    const { container } = await renderView(undefined)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("hands the month today's Manila date and the heading that names it", async () => {
    await renderView("2026-11")

    expect(monthProps()).toEqual({
      month: "2026-11",
      scope: null,
      today: "2026-10-08",
      headingId: screen.getByRole("heading", { level: 2 }).id,
    })
    expect(monthProps().headingId).not.toBe("")
  })

  it("resolves the current Manila month when it is already the 1st there", async () => {
    // 12:30 AM on Sun, Nov 1 in Manila; still Oct 31 in UTC.
    vi.setSystemTime(new Date("2026-10-31T16:30:00Z"))

    await renderView(undefined)

    expect(
      screen.getByRole("heading", { level: 2, name: "November 2026" })
    ).toBeInTheDocument()
    expect(monthProps().month).toBe("2026-11")
    expect(monthProps().today).toBe("2026-11-01")
  })

  it.each([
    ["month 13", "2026-13"],
    ["not a month", "abc"],
    ["a one-digit month", "2026-1"],
    ["a repeated month", ["2026-11", "2026-12"]],
  ])("shows the current month for %s", async (_label, month) => {
    await renderView(month)

    expect(monthProps().month).toBe("2026-10")
    expect(
      screen.getByRole("heading", { level: 2, name: "October 2026" })
    ).toBeInTheDocument()
  })

  it.each([
    ["2026-01", "2025-12", "2026-02"],
    ["2026-12", "2026-11", "2027-01"],
  ])(
    "links Previous and Next from %s to %s and %s, and Today to the current month",
    async (month, previous, next) => {
      await renderView(month)

      expect(hrefOf("Previous month")).toBe(
        `/dashboard?view=planner&month=${previous}`
      )
      expect(hrefOf("Next month")).toBe(`/dashboard?view=planner&month=${next}`)
      expect(hrefOf("Today")).toBe("/dashboard?view=planner")
    }
  )

  it.each([
    ["Next month", "9999-12", "Previous month", "9999-11"],
    ["Previous month", "1000-01", "Next month", "1000-02"],
  ])(
    "leaves %s out on %s, the edge of the months a link may name",
    async (missing, month, kept, keptMonth) => {
      await renderView(month)

      expect(screen.queryByRole("link", { name: missing })).toBeNull()
      expect(hrefOf(kept)).toBe(`/dashboard?view=planner&month=${keptMonth}`)
      expect(hrefOf("Today")).toBe("/dashboard?view=planner")
    }
  )

  it("makes every control a 44px link, never a button", async () => {
    await renderView(undefined)

    for (const name of ["Previous month", "Today", "Next month"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("h-11")
    }
    expect(screen.queryByRole("button")).toBeNull()
  })

  it.each([
    ["a Staff Layout Artist", { kind: "desk", id: "layout" }, "Layout too"],
    ["a Feature Editor", { kind: "section", id: "feature" }, "Feature too"],
    ["a Staff Writer", { kind: "articles" }, "All articles too"],
  ])("names the toggle for %s", async (_label, homeScope, label) => {
    getMyHomeScope.mockResolvedValue(homeScope)

    await renderView(undefined)

    expect(PlannerScopeToggle.mock.calls[0][0].label).toBe(label)
  })

  it.each([
    ["the Editor-in-Chief (All)", { kind: "all" }],
    ["a scope naming no listed owner", { kind: "desk", id: "gone" }],
    ["the Writers desk", { kind: "desk", id: "writers" }],
  ])("gives %s no toggle", async (_label, homeScope) => {
    getMyHomeScope.mockResolvedValue(homeScope)

    await renderView(undefined, "home")

    expect(PlannerScopeToggle).not.toHaveBeenCalled()
    // scope=home without a toggle is ignored.
    expect(monthProps().scope).toBeNull()
    expect(hrefOf("Today")).toBe("/dashboard?view=planner")
  })

  it("turns the toggle on for scope=home, adding the scope's tasks and keeping scope in every link", async () => {
    await renderView("2026-11", "home")

    expect(PlannerScopeToggle.mock.calls[0][0]).toEqual({
      label: "Layout too",
      checked: true,
      month: "2026-11",
    })
    expect(monthProps().scope).toEqual({ kind: "desk", id: "layout" })
    expect(hrefOf("Previous month")).toBe(
      "/dashboard?view=planner&month=2026-10&scope=home"
    )
    expect(hrefOf("Next month")).toBe(
      "/dashboard?view=planner&month=2026-12&scope=home"
    )
    expect(hrefOf("Today")).toBe("/dashboard?view=planner&scope=home")
  })

  it.each([
    ["missing", undefined],
    ["another value", "all"],
    ["repeated", ["home", "home"]],
  ])("leaves the toggle off when scope is %s", async (_label, scope) => {
    await renderView(undefined, scope)

    // The month on screen, even without a `month` parameter, so a page left
    // open past the end of the month doesn't jump when toggled.
    expect(PlannerScopeToggle.mock.calls[0][0]).toEqual({
      label: "Layout too",
      checked: false,
      month: "2026-10",
    })
    expect(monthProps().scope).toBeNull()
  })

  it("keys the month's own Suspense boundary by the month and toggle, with the controls and toggle outside it", async () => {
    const off = await PlannerView({ month: "2026-11", scope: undefined })
    const on = await PlannerView({ month: "2026-11", scope: "home" })
    const offBoundary = findElement(off, Suspense)
    const onBoundary = findElement(on, Suspense)

    expect(offBoundary?.key).toContain("2026-11")
    expect(onBoundary?.key).toContain("2026-11")
    expect(offBoundary?.key).not.toBe(onBoundary?.key)

    const props = onBoundary?.props as {
      fallback: ReactElement
      children: ReactNode
    }
    expect(props.fallback.type).toBe(PlannerMonthSkeleton)
    expect(findElement(props.children, PlannerMonth)).toBeDefined()
    // The toggle, the month links and the month heading stay outside, so a
    // month change or a toggle keeps them mounted and focused.
    expect(findElement(props.children, PlannerScopeToggle)).toBeUndefined()
    expect(findElement(on, PlannerScopeToggle)).toBeDefined()
    expect(findElement(props.children, Link)).toBeUndefined()
    expect(findElement(on, Link)).toBeDefined()
    expect(findElement(props.children, "h2")).toBeUndefined()
    expect(findElement(on, "h2")).toBeDefined()
  })

  it.each([
    ["2026-02", 4],
    ["2026-10", 5],
    ["2026-08", 6],
  ])(
    "gives the month's skeleton %s's own number of weeks (%i)",
    async (month, weeks) => {
      const view = await PlannerView({ month, scope: undefined })
      const props = findElement(view, Suspense)?.props as {
        fallback: ReactElement<{ weeks: number }>
      }

      expect(props.fallback.props.weeks).toBe(weeks)
    }
  )

  it("lets a query failure throw", async () => {
    getBoardOwners.mockRejectedValue(new Error("boom"))
    await expect(
      PlannerView({ month: undefined, scope: undefined })
    ).rejects.toThrow("boom")

    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockRejectedValue(new Error("scope boom"))
    await expect(
      PlannerView({ month: undefined, scope: undefined })
    ).rejects.toThrow("scope boom")
  })

  it("has no axe violations", async () => {
    const { container } = await renderView(undefined, "home")

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
