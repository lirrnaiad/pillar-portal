import { describe, expect, it } from "vitest"

import { DASHBOARD_VIEW_TITLES, parseDashboardView } from "./dashboard-views"

describe("parseDashboardView", () => {
  it("reads board", () => {
    expect(parseDashboardView("board")).toBe("board")
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "planner"],
    ["a different case", "Board"],
    ["repeated", ["board", "board"]],
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
    })
  })
})
