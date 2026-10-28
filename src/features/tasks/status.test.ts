import { describe, expect, it } from "vitest"

import { isTaskOverdue, SENT_BACK_LABEL, taskStatus } from "./status"

const NOW = new Date("2026-10-15T00:00:00Z")

describe("isTaskOverdue", () => {
  it("is overdue when the due date is past and the task isn't Done", () => {
    expect(isTaskOverdue("2026-10-14T23:59:59Z", "to_do", NOW)).toBe(true)
    expect(isTaskOverdue("2026-10-01T00:00:00Z", "for_review", NOW)).toBe(true)
  })

  it("is never overdue once Done", () => {
    expect(isTaskOverdue("2026-10-01T00:00:00Z", "done", NOW)).toBe(false)
  })

  it("is not overdue at or before the due instant", () => {
    expect(isTaskOverdue("2026-10-15T00:00:00Z", "doing", NOW)).toBe(false)
    expect(isTaskOverdue("2026-10-16T00:00:00Z", "doing", NOW)).toBe(false)
  })
})

describe("taskStatus", () => {
  it.each([
    ["to_do", { family: "neutral", label: "To Do" }],
    ["doing", { family: "progress", label: "Doing" }],
    ["for_review", { family: "progress", label: "For Review" }],
    ["done", { family: "positive", label: "Done" }],
  ] as const)("is the column's label and family for %s", (column, expected) => {
    expect(taskStatus(column, false)).toEqual(expected)
  })

  it('is "Sent back" in the attention family while the note stands, whatever the column', () => {
    expect(SENT_BACK_LABEL).toBe("Sent back")
    for (const column of ["to_do", "doing", "for_review"] as const) {
      expect(taskStatus(column, true)).toEqual({
        family: "attention",
        label: "Sent back",
      })
    }
  })
})
