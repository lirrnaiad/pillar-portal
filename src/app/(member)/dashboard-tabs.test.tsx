// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname }))

import { DashboardTabs } from "./dashboard-tabs"

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

  it("is present but not current on a task's page", () => {
    usePathname.mockReturnValue("/dashboard/tasks/abc")
    render(<DashboardTabs />)

    const link = screen.getByRole("link", { name: "What's mine" })
    expect(link).not.toHaveAttribute("aria-current")
    expect(link).toHaveClass("min-h-11", "text-white/72")
    expect(link).not.toHaveClass("border-white")
  })

  it("has no axe violations", async () => {
    usePathname.mockReturnValue("/dashboard")
    const { container } = render(<DashboardTabs />)

    expect(await axeViolations(container)).toEqual([])
  })
})
