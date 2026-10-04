import { describe, expect, it } from "vitest"

import type { TaskOwnerOption } from "./board"
import {
  deadlineCount,
  parseIncludeScope,
  plannerChipLabel,
  plannerChipStatus,
  plannerHref,
  plannerScopeLabel,
  tasksByDay,
} from "./planner"

const OWNERS: TaskOwnerOption[] = [
  { kind: "section", id: "news", name: "News" },
  { kind: "section", id: "feature", name: "Feature" },
  { kind: "desk", id: "layout", name: "Layout" },
]

describe("plannerScopeLabel", () => {
  it.each([
    [
      "a desk (Staff Layout Artist)",
      { kind: "desk", id: "layout" },
      "Layout too",
    ],
    [
      "a section (Feature Editor)",
      { kind: "section", id: "feature" },
      "Feature too",
    ],
    ["all articles (Staff Writer)", { kind: "articles" }, "All articles too"],
  ] as const)("names %s", (_label, scope, expected) => {
    expect(plannerScopeLabel(scope, OWNERS)).toBe(expected)
  })
})

describe("parseIncludeScope", () => {
  it("is on for scope=home", () => {
    expect(parseIncludeScope("home")).toBe(true)
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["another value", "all"],
    ["a different case", "Home"],
    ["repeated", ["home", "home"]],
  ])("is off when the value is %s", (_label, value) => {
    expect(parseIncludeScope(value)).toBe(false)
  })
})

describe("plannerHref", () => {
  it.each([
    [{ includeScope: false }, "/dashboard?view=planner"],
    [{ includeScope: true }, "/dashboard?view=planner&scope=home"],
    [
      { month: "2025-12", includeScope: false },
      "/dashboard?view=planner&month=2025-12",
    ],
    [
      { month: "2027-01", includeScope: true },
      "/dashboard?view=planner&month=2027-01&scope=home",
    ],
  ])("builds %j as %s", (input, expected) => {
    expect(plannerHref(input)).toBe(expected)
  })
})

describe("tasksByDay", () => {
  it("groups by the Manila due date, keeping the given order within a day", () => {
    const tasks = [
      { id: "a", dueAt: "2026-10-31T15:30:00Z" }, // 11:30 PM Oct 31 in Manila
      { id: "b", dueAt: "2026-10-31T16:30:00Z" }, // 12:30 AM Nov 1 in Manila
      { id: "c", dueAt: "2026-10-30T16:00:00Z" }, // midnight Oct 31 in Manila
    ]

    expect(
      [...tasksByDay(tasks)].map(([day, list]) => [
        day,
        list.map((task) => task.id),
      ])
    ).toEqual([
      ["2026-10-31", ["a", "c"]],
      ["2026-11-01", ["b"]],
    ])
  })
})

describe("deadlineCount", () => {
  it.each([
    [0, "No deadlines"],
    [1, "1 deadline"],
    [2, "2 deadlines"],
    [12, "12 deadlines"],
  ])("reads %i as %s", (count, expected) => {
    expect(deadlineCount(count)).toBe(expected)
  })
})

describe("plannerChipStatus", () => {
  it.each([
    ["to_do", { kind: "to_do", label: "To Do" }],
    ["doing", { kind: "doing", label: "Doing" }],
    ["for_review", { kind: "for_review", label: "For Review" }],
    ["done", { kind: "done", label: "Done" }],
  ] as const)("is the column label for %s", (column, expected) => {
    expect(plannerChipStatus({ column, overdue: false })).toEqual(expected)
  })

  it("is Overdue when the task is", () => {
    expect(plannerChipStatus({ column: "doing", overdue: true })).toEqual({
      kind: "overdue",
      label: "Overdue",
    })
  })
})

describe("plannerChipLabel", () => {
  // Sat, Oct 10 2026, 5:00 PM in Manila.
  const TASK = {
    title: "Masthead brief",
    dueAt: "2026-10-10T09:00:00Z",
    column: "to_do",
    overdue: false,
  } as const

  it("names the title, the status and the PHT due time", () => {
    expect(plannerChipLabel(TASK)).toBe(
      "Masthead brief, To Do, due Sat, Oct 10 at 5:00 PM"
    )
  })

  it("says Overdue for an overdue task", () => {
    expect(plannerChipLabel({ ...TASK, overdue: true })).toBe(
      "Masthead brief, Overdue, due Sat, Oct 10 at 5:00 PM"
    )
  })
})
