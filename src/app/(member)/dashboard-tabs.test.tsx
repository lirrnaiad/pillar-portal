// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { usePathname, useSearchParams } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}))
vi.mock("next/navigation", () => ({ usePathname, useSearchParams }))

import { DashboardTabs } from "./dashboard-tabs"

beforeEach(() => {
  useSearchParams.mockReturnValue(new URLSearchParams())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

describe("DashboardTabs", () => {
  it("is a Dashboard views nav with What's mine linking to /dashboard", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs />)

    const nav = screen.getByRole("navigation", { name: "Dashboard views" })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "What's mine" })).toHaveAttribute(
      "href",
      "/dashboard"
    )
  })

  it("marks What's mine current on /dashboard", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs />)

    const link = screen.getByRole("link", { name: "What's mine" })
    expect(link).toHaveAttribute("aria-current", "page")
    expect(link).toHaveClass("border-white", "text-white")
    // The mockup's tab: 14px semibold, centred, with a straight underline.
    expect(link).toHaveClass("text-sm", "font-semibold", "justify-center")
    expect(link).not.toHaveClass("rounded-sm")
  })

  it("links Board to /dashboard?view=board", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs />)

    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "href",
      "/dashboard?view=board"
    )
  })

  it("marks Board current, and not What's mine, on /dashboard?view=board", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams("view=board&owner=all"))
    render(<DashboardTabs />)

    const board = screen.getByRole("link", { name: "Board" })
    expect(board).toHaveAttribute("aria-current", "page")
    expect(board).toHaveClass("border-white", "text-white")
    const mine = screen.getByRole("link", { name: "What's mine" })
    expect(mine).not.toHaveAttribute("aria-current")
    expect(mine).toHaveClass("text-white/72")
  })

  it("reads What's mine · Board · Planner, in that order", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs />)

    const nav = screen.getByRole("navigation", { name: "Dashboard views" })
    expect(
      [...nav.querySelectorAll("a")].map((link) => link.textContent)
    ).toEqual(["What's mine", "Board", "Planner"])
  })

  it("links Planner to /dashboard?view=planner", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs />)

    expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute(
      "href",
      "/dashboard?view=planner"
    )
  })

  it("marks Planner current, and no other tab, on /dashboard?view=planner", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(
      new URLSearchParams("view=planner&month=2026-11&scope=home")
    )
    render(<DashboardTabs />)

    const planner = screen.getByRole("link", { name: "Planner" })
    expect(planner).toHaveAttribute("aria-current", "page")
    expect(planner).toHaveClass("border-white", "text-white")
    for (const name of ["What's mine", "Board"]) {
      const link = screen.getByRole("link", { name })
      expect(link).not.toHaveAttribute("aria-current")
      expect(link).toHaveClass("text-white/72")
    }
  })

  // Read as the page reads it: a repeated view renders What's mine.
  it.each([
    ["an unknown view", "view=nope"],
    ["a repeated view", "view=board&view=board"],
    ["a repeated planner view", "view=planner&view=planner"],
  ])("keeps What's mine current for %s", (_label, search) => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams(search))
    render(<DashboardTabs />)

    expect(screen.getByRole("link", { name: "What's mine" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const name of ["Board", "Planner"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  it("is present but not current on a task's page", () => {
    usePathname.mockReturnValue("/dashboard/tasks/abc")
    useSearchParams.mockReturnValue(new URLSearchParams("view=planner"))
    render(<DashboardTabs />)

    const link = screen.getByRole("link", { name: "What's mine" })
    expect(link).not.toHaveAttribute("aria-current")
    for (const name of ["Board", "Planner"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
    expect(link).toHaveClass("min-h-11", "text-white/72")
    expect(link).not.toHaveClass("border-white")
  })

  it("has no axe violations", async () => {
    usePathname.mockReturnValue("/dashboard")
    const { container } = render(<DashboardTabs />)

    expect(await axeViolations(container)).toEqual([])
  })
})
