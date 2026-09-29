import { describe, expect, it } from "vitest"

import { isTaskOverdue } from "./status"

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
