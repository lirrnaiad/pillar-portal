// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { getPlanner, PlannerGrid, PlannerDayList } = vi.hoisted(() => ({
  getPlanner: vi.fn(),
  PlannerGrid: vi.fn(({ tasks }: { tasks: unknown[] }) => (
    <p>grid with {tasks.length} tasks</p>
  )),
  PlannerDayList: vi.fn(({ tasks }: { tasks: unknown[] }) => (
    <p>day list with {tasks.length} tasks</p>
  )),
}))

vi.mock("@/features/tasks", () => ({ getPlanner, PlannerGrid, PlannerDayList }))

import { PlannerMonth } from "./planner-month"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const PROPS = {
  month: "2026-10",
  scope: { kind: "desk", id: "layout" } as const,
  today: "2026-10-08",
  headingId: "planner-month-heading",
}

describe("PlannerMonth", () => {
  it("reads the month with the scope, and hands the tasks to the grid (md up) and the day list (below md)", async () => {
    const tasks = [{ id: "a" }, { id: "b" }]
    getPlanner.mockResolvedValue(tasks)

    render(await PlannerMonth(PROPS))

    expect(getPlanner).toHaveBeenCalledWith("2026-10", {
      kind: "desk",
      id: "layout",
    })
    expect(PlannerGrid.mock.calls[0][0]).toEqual({
      month: "2026-10",
      today: "2026-10-08",
      tasks,
      labelledBy: "planner-month-heading",
    })
    expect(PlannerDayList.mock.calls[0][0]).toEqual({
      month: "2026-10",
      today: "2026-10-08",
      tasks,
    })
    expect(screen.getByText("grid with 2 tasks").parentElement).toHaveClass(
      "hidden",
      "md:block"
    )
    expect(screen.getByText("day list with 2 tasks").parentElement).toHaveClass(
      "md:hidden"
    )
  })

  it("reads without a scope when the toggle is off", async () => {
    getPlanner.mockResolvedValue([])

    await PlannerMonth({ ...PROPS, scope: null })

    expect(getPlanner).toHaveBeenCalledWith("2026-10", null)
  })

  it("shows only 'No deadlines this month.' for an empty month, with no grid and no list", async () => {
    getPlanner.mockResolvedValue([])

    const { container } = render(await PlannerMonth(PROPS))

    expect(container).toHaveTextContent(/^No deadlines this month\.$/)
    expect(PlannerGrid).not.toHaveBeenCalled()
    expect(PlannerDayList).not.toHaveBeenCalled()
  })

  it("lets a query failure throw", async () => {
    getPlanner.mockRejectedValue(new Error("boom"))

    await expect(PlannerMonth(PROPS)).rejects.toThrow("boom")
  })

  it("has no axe violations in the empty month", async () => {
    getPlanner.mockResolvedValue([])
    const { container } = render(await PlannerMonth(PROPS))

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
