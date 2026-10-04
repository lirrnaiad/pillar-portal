// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { Suspense, use, useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlannerScopeToggle } from "./planner-scope-toggle"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const toggle = () => screen.getByRole("switch", { name: "Layout too" })

describe("PlannerScopeToggle", () => {
  it("is a switch named for the home scope, showing whether it is on", () => {
    const { rerender } = render(
      <PlannerScopeToggle label="Layout too" checked={false} />
    )
    expect(toggle()).toHaveAttribute("aria-checked", "false")

    rerender(<PlannerScopeToggle label="Layout too" checked />)
    expect(toggle()).toHaveAttribute("aria-checked", "true")
  })

  it("is a 44px row whose label also flips it", async () => {
    const user = userEvent.setup()
    render(<PlannerScopeToggle label="Layout too" checked={false} />)

    const label = screen.getByText("Layout too")
    expect(label).toHaveClass("min-h-11")

    await user.click(label)

    expect(push).toHaveBeenCalledWith("/dashboard?view=planner&scope=home")
  })

  it("pushes the Planner with scope=home when switched on, keeping the month", async () => {
    const user = userEvent.setup()
    render(
      <PlannerScopeToggle label="Layout too" checked={false} month="2026-11" />
    )

    await user.click(toggle())

    expect(push).toHaveBeenCalledWith(
      "/dashboard?view=planner&month=2026-11&scope=home"
    )
  })

  it("pushes the Planner without scope when switched off", async () => {
    const user = userEvent.setup()
    render(<PlannerScopeToggle label="Layout too" checked month="2026-11" />)

    await user.click(toggle())

    expect(push).toHaveBeenCalledWith("/dashboard?view=planner&month=2026-11")
  })

  it("shows the new state at once, while the navigation is still pending", async () => {
    // A push that never finishes: inside the toggle's transition it moves a
    // sibling onto a promise that never settles, which keeps the transition
    // pending the way a slow server render does. The switch must already
    // read on, from its optimistic state rather than the `checked` prop.
    const never = new Promise<never>(() => {})
    let stall = () => {}
    function Stall() {
      const [stalled, setStalled] = useState(false)
      stall = () => setStalled(true)
      if (stalled) use(never)
      return null
    }
    push.mockImplementation(() => stall())
    const user = userEvent.setup()
    render(
      <>
        <PlannerScopeToggle label="Layout too" checked={false} />
        <Suspense fallback={null}>
          <Stall />
        </Suspense>
      </>
    )

    await user.click(toggle())

    expect(push).toHaveBeenCalledWith("/dashboard?view=planner&scope=home")
    expect(toggle()).toHaveAttribute("aria-checked", "true")
  })

  it("leaves the month out when none was given (the current month)", async () => {
    const user = userEvent.setup()
    render(<PlannerScopeToggle label="All articles too" checked />)

    await user.click(screen.getByRole("switch", { name: "All articles too" }))

    expect(push).toHaveBeenCalledWith("/dashboard?view=planner")
  })

  it("flips with the keyboard and keeps focus", async () => {
    const user = userEvent.setup()
    render(<PlannerScopeToggle label="Layout too" checked={false} />)

    await user.tab()
    expect(toggle()).toHaveFocus()
    await user.keyboard(" ")

    expect(push).toHaveBeenCalledWith("/dashboard?view=planner&scope=home")
    expect(toggle()).toHaveFocus()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <PlannerScopeToggle label="Layout too" checked={false} />
    )

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
