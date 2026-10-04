import { describe, expect, it } from "vitest"

import { DASHBOARD_VIEW_TITLES, parseDashboardView } from "./dashboard-views"

describe("parseDashboardView", () => {
  it.each(["board", "planner"] as const)("reads %s", (view) => {
    expect(parseDashboardView(view)).toBe(view)
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "calendar"],
    ["a different case", "Board"],
    ["a different case of planner", "Planner"],
    ["repeated", ["board", "board"]],
    ["a repeated planner", ["planner", "planner"]],
    ["null", null],
  ])("falls back to What's mine when the value is %s", (_label, value) => {
    expect(parseDashboardView(value)).toBe("whats-mine")
  })
})

describe("DASHBOARD_VIEW_TITLES", () => {
  it("titles each view", () => {
    expect(DASHBOARD_VIEW_TITLES).toEqual({
      "whats-mine": "What's mine · The Pillar Portal",
      board: "Board · The Pillar Portal",
      planner: "Planner · The Pillar Portal",
    })
  })
})
