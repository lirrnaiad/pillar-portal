import { describe, expect, it, vi } from "vitest"

// taskCreateSchema imports PRODUCTION_ROLE_LABELS through @/features/members,
// whose index.ts also pulls in actions.ts (env.client) and queries.ts
// (supabase/server) at module load. Neither is exercised here.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

const { slotRespondSchema, taskCreateSchema, taskMoveSchema } = await import(
  "./schemas"
)

const VALID = {
  title: "Lay out the spread",
  description: null,
  owningSectionId: "news",
  owningDeskId: null,
  dueAt: "2026-10-31T23:30",
  referenceUrl: null,
  slots: [
    { role: "layout_artist" as const, memberId: "00000000-0000-4000-8000-000000000001" },
  ],
}

function issuesFor(input: unknown) {
  const result = taskCreateSchema.safeParse(input)
  if (result.success) return []
  return result.error.issues
}

describe("taskCreateSchema", () => {
  it("accepts a valid submission", () => {
    expect(taskCreateSchema.safeParse(VALID).success).toBe(true)
  })

  it("accepts a description, and an https(s) reference link", () => {
    const result = taskCreateSchema.safeParse({
      ...VALID,
      description: "Cover the spread for the November issue.",
      referenceUrl: "https://docs.example.com/brief",
    })
    expect(result.success).toBe(true)
  })

  it("rejects a blank title", () => {
    const issues = issuesFor({ ...VALID, title: "   " })
    expect(issues.some((i) => i.path.join(".") === "title")).toBe(true)
  })

  it("rejects a title over 200 characters", () => {
    const issues = issuesFor({ ...VALID, title: "x".repeat(201) })
    expect(issues.some((i) => i.path.join(".") === "title")).toBe(true)
  })

  it("rejects a description over 5000 characters", () => {
    const issues = issuesFor({ ...VALID, description: "x".repeat(5001) })
    expect(issues.some((i) => i.path.join(".") === "description")).toBe(true)
  })

  it("rejects two owners (both section and desk set)", () => {
    const issues = issuesFor({ ...VALID, owningDeskId: "layout" })
    expect(
      issues.some(
        (i) => i.path.join(".") === "owningSectionId" && i.message === "Choose one owner"
      )
    ).toBe(true)
  })

  it("rejects no owner (neither section nor desk set)", () => {
    const issues = issuesFor({ ...VALID, owningSectionId: null })
    expect(
      issues.some(
        (i) => i.path.join(".") === "owningSectionId" && i.message === "Choose one owner"
      )
    ).toBe(true)
  })

  it.each(["", "not-a-date", "2026-10-31", "2026/10/31T23:30"])(
    "rejects a malformed due date %j with 'Add a due date'",
    (dueAt) => {
      const issues = issuesFor({ ...VALID, dueAt })
      expect(
        issues.some((i) => i.path.join(".") === "dueAt" && i.message === "Add a due date")
      ).toBe(true)
    }
  )

  it("rejects a malformed reference link", () => {
    const issues = issuesFor({ ...VALID, referenceUrl: "not-a-url" })
    expect(issues.some((i) => i.path.join(".") === "referenceUrl")).toBe(true)
  })

  it("rejects a reference link over 2048 characters", () => {
    const issues = issuesFor({
      ...VALID,
      referenceUrl: `https://example.com/${"x".repeat(2048)}`,
    })
    expect(issues.some((i) => i.path.join(".") === "referenceUrl")).toBe(true)
  })

  it("rejects no slots", () => {
    const issues = issuesFor({ ...VALID, slots: [] })
    expect(
      issues.some(
        (i) => i.path.join(".") === "slots" && i.message === "Add at least one slot"
      )
    ).toBe(true)
  })

  it("rejects a slot with an invalid role", () => {
    const issues = issuesFor({
      ...VALID,
      slots: [{ role: "not-a-role", memberId: VALID.slots[0].memberId }],
    })
    expect(issues.some((i) => i.path.join(".") === "slots.0.role")).toBe(true)
  })

  it("rejects a slot whose memberId isn't a UUID", () => {
    const issues = issuesFor({
      ...VALID,
      slots: [{ role: "layout_artist", memberId: "not-a-uuid" }],
    })
    expect(issues.some((i) => i.path.join(".") === "slots.0.memberId")).toBe(true)
  })

  it("rejects more than 20 slots", () => {
    const issues = issuesFor({
      ...VALID,
      slots: Array.from({ length: 21 }, (_, i) => ({
        role: "layout_artist" as const,
        memberId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      })),
    })
    expect(issues.some((i) => i.path.join(".") === "slots")).toBe(true)
  })

  it("rejects two slots with the same role and member", () => {
    const issues = issuesFor({
      ...VALID,
      slots: [...VALID.slots, ...VALID.slots],
    })
    expect(
      issues.some(
        (i) =>
          i.path.join(".") === "slots" &&
          i.message === "The same member already has that role — remove one"
      )
    ).toBe(true)
  })

  it("accepts the same member in two different roles", () => {
    const result = taskCreateSchema.safeParse({
      ...VALID,
      slots: [
        { role: "layout_artist" as const, memberId: VALID.slots[0].memberId },
        { role: "cartoonist" as const, memberId: VALID.slots[0].memberId },
      ],
    })
    expect(result.success).toBe(true)
  })
})

const SLOT_ID = "00000000-0000-4000-8000-000000000011"
const TASK_ID = "00000000-0000-4000-8000-000000000021"

describe("slotRespondSchema", () => {
  it.each(["on_it", "needs_reassignment"])("accepts the %s response", (response) => {
    expect(slotRespondSchema.safeParse({ slotId: SLOT_ID, response }).success).toBe(true)
  })

  it("refuses awaiting_response, which isn't a response", () => {
    const result = slotRespondSchema.safeParse({
      slotId: SLOT_ID,
      response: "awaiting_response",
    })
    expect(result.success).toBe(false)
  })

  it("refuses a slot id that isn't a UUID", () => {
    const result = slotRespondSchema.safeParse({ slotId: "abc", response: "on_it" })
    expect(result.success).toBe(false)
  })

  it("trims the reason", () => {
    const result = slotRespondSchema.parse({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "  Exams all week \n",
    })
    expect(result.reason).toBe("Exams all week")
  })

  it.each([undefined, null, "", "   \t\n "])("turns a blank reason (%j) into null", (reason) => {
    const result = slotRespondSchema.parse({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason,
    })
    expect(result.reason).toBeNull()
  })

  it("accepts a 280-character reason, counted after trimming", () => {
    const result = slotRespondSchema.safeParse({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: `  ${"x".repeat(280)}  `,
    })
    expect(result.success).toBe(true)
  })

  it("refuses a reason over 280 characters", () => {
    const issues = slotRespondSchema.safeParse({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "x".repeat(281),
    }).error?.issues
    expect(
      issues?.some(
        (i) =>
          i.path.join(".") === "reason" &&
          i.message === "Keep the reason under 280 characters"
      )
    ).toBe(true)
  })
})

describe("taskMoveSchema", () => {
  it.each(["to_do", "doing", "for_review", "done"])("accepts a move to %s", (toColumn) => {
    expect(taskMoveSchema.safeParse({ taskId: TASK_ID, toColumn }).success).toBe(true)
  })

  it("refuses a column that doesn't exist", () => {
    expect(
      taskMoveSchema.safeParse({ taskId: TASK_ID, toColumn: "archived" }).success
    ).toBe(false)
  })

  it("refuses a task id that isn't a UUID", () => {
    expect(taskMoveSchema.safeParse({ taskId: "abc", toColumn: "doing" }).success).toBe(false)
  })
})
