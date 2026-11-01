import { describe, expect, it } from "vitest"

import { taskEditKey } from "./task-edit-key"

const VERSION = "2026-10-30T02:15:42.123456+00:00"
const SLOT_A = "00000000-0000-4000-8000-000000000031"
const SLOT_B = "00000000-0000-4000-8000-000000000032"
const STAFF = "00000000-0000-4000-8000-000000000001"
const HEAD = "00000000-0000-4000-8000-000000000002"

const TASK = {
  updatedAt: VERSION,
  slots: [
    { id: SLOT_A, memberId: STAFF },
    { id: SLOT_B, memberId: STAFF },
  ],
}

describe("taskEditKey", () => {
  it("is the version, then each slot's id and member, in slot order", () => {
    expect(taskEditKey(TASK)).toBe(
      `${VERSION}|${SLOT_A}:${STAFF}|${SLOT_B}:${STAFF}`
    )
  })

  it("is the same for the same task", () => {
    expect(taskEditKey({ ...TASK, slots: [...TASK.slots] })).toBe(
      taskEditKey(TASK)
    )
  })

  it.each([
    [
      "a newer version",
      { ...TASK, updatedAt: "2026-10-30T02:15:42.123457+00:00" },
    ],
    [
      "a slot with another member",
      { ...TASK, slots: [TASK.slots[0], { id: SLOT_B, memberId: HEAD }] },
    ],
    ["a slot removed", { ...TASK, slots: [TASK.slots[0]] }],
    [
      "a slot added",
      {
        ...TASK,
        slots: [
          ...TASK.slots,
          { id: "00000000-0000-4000-8000-000000000033", memberId: HEAD },
        ],
      },
    ],
  ])("changes with %s", (_name, task) => {
    expect(taskEditKey(task)).not.toBe(taskEditKey(TASK))
  })
})
