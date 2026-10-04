// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { PlannerMonthSkeleton, PlannerSkeleton } from "./planner-skeleton"

afterEach(cleanup)

describe("PlannerSkeleton", () => {
  it("marks itself for the wide shell, so the width doesn't jump on load", () => {
    const { container } = render(<PlannerSkeleton />)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("is a busy status that says it is loading the planner", () => {
    render(<PlannerSkeleton />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading the planner")
  })

  it("has no axe violations", async () => {
    const { container } = render(<PlannerSkeleton />)

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})

describe("PlannerMonthSkeleton", () => {
  it("outlines the grid from md and the day list below it", () => {
    const { container } = render(<PlannerMonthSkeleton />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading the planner")
    expect(container.querySelector(".md\\:grid")?.children).toHaveLength(35)
    expect(container.querySelector(".md\\:hidden")).not.toBeNull()
  })

  it.each([4, 6])(
    "draws %i weeks when told, so a short or long month doesn't jump",
    (weeks) => {
      const { container } = render(<PlannerMonthSkeleton weeks={weeks} />)

      expect(container.querySelector(".md\\:grid")?.children).toHaveLength(
        weeks * 7
      )
    }
  )

  it("has no wide-view marker of its own (the Planner's root carries it)", () => {
    const { container } = render(<PlannerMonthSkeleton />)

    expect(container.querySelector("[data-wide-view]")).toBeNull()
  })
})
