import { describe, expect, it, vi } from "vitest"

// taskCreateSchema imports PRODUCTION_ROLE_LABELS through @/features/members,
// whose index.ts also pulls in actions.ts (env.client) and queries.ts
// (supabase/server) at module load. Neither is exercised here.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

const {
  REVISION_NOTE_MAX,
  slotHandBackSchema,
  slotReassignSchema,
  slotRespondSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskDeleteSchema,
  taskReviewSchema,
  taskSendBackSchema,
  taskUpdateSchema,
} = await import("./schemas")

const VALID = {
  title: "Lay out the spread",
  description: null,
  owningSectionId: "news",
  owningDeskId: null,
  dueAt: "2026-10-31T23:30",
  referenceUrl: null,
  slots: [
    {
      role: "layout_artist" as const,
      memberId: "00000000-0000-4000-8000-000000000001",
    },
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
        (i) =>
          i.path.join(".") === "owningSectionId" &&
          i.message === "Choose one owner"
      )
    ).toBe(true)
  })

  it("rejects no owner (neither section nor desk set)", () => {
    const issues = issuesFor({ ...VALID, owningSectionId: null })
    expect(
      issues.some(
        (i) =>
          i.path.join(".") === "owningSectionId" &&
          i.message === "Choose one owner"
      )
    ).toBe(true)
  })

  it.each(["", "not-a-date", "2026-10-31", "2026/10/31T23:30"])(
    "rejects a malformed due date %j with 'Add a due date'",
    (dueAt) => {
      const issues = issuesFor({ ...VALID, dueAt })
      expect(
        issues.some(
          (i) => i.path.join(".") === "dueAt" && i.message === "Add a due date"
        )
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
        (i) =>
          i.path.join(".") === "slots" && i.message === "Add at least one slot"
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
    expect(issues.some((i) => i.path.join(".") === "slots.0.memberId")).toBe(
      true
    )
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
  it.each(["on_it", "needs_reassignment"])(
    "accepts the %s response",
    (response) => {
      expect(
        slotRespondSchema.safeParse({ slotId: SLOT_ID, response }).success
      ).toBe(true)
    }
  )

  it("refuses awaiting_response, which isn't a response", () => {
    const result = slotRespondSchema.safeParse({
      slotId: SLOT_ID,
      response: "awaiting_response",
    })
    expect(result.success).toBe(false)
  })

  it("refuses a slot id that isn't a UUID", () => {
    const result = slotRespondSchema.safeParse({
      slotId: "abc",
      response: "on_it",
    })
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

  it.each([undefined, null, "", "   \t\n "])(
    "turns a blank reason (%j) into null",
    (reason) => {
      const result = slotRespondSchema.parse({
        slotId: SLOT_ID,
        response: "needs_reassignment",
        reason,
      })
      expect(result.reason).toBeNull()
    }
  )

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
  it.each(["to_do", "doing", "for_review", "done"])(
    "accepts a move to %s",
    (toColumn) => {
      expect(
        taskMoveSchema.safeParse({ taskId: TASK_ID, toColumn }).success
      ).toBe(true)
    }
  )

  it("refuses a column that doesn't exist", () => {
    expect(
      taskMoveSchema.safeParse({ taskId: TASK_ID, toColumn: "archived" })
        .success
    ).toBe(false)
  })

  it("refuses a task id that isn't a UUID", () => {
    expect(
      taskMoveSchema.safeParse({ taskId: "abc", toColumn: "doing" }).success
    ).toBe(false)
  })
})

describe("taskReviewSchema", () => {
  it("accepts a task id", () => {
    expect(taskReviewSchema.safeParse({ taskId: TASK_ID }).success).toBe(true)
  })

  it("refuses a task id that isn't a UUID", () => {
    expect(taskReviewSchema.safeParse({ taskId: "abc" }).success).toBe(false)
  })
})

describe("taskSendBackSchema", () => {
  it("trims the note", () => {
    expect(
      taskSendBackSchema.parse({ taskId: TASK_ID, note: "  fix captions \n" })
    ).toEqual({ taskId: TASK_ID, note: "fix captions" })
  })

  it.each(["", "   ", "\t\n "])(
    "refuses the blank note %j with the dialog's copy",
    (note) => {
      const result = taskSendBackSchema.safeParse({ taskId: TASK_ID, note })
      expect(result.success).toBe(false)
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["note"],
          message: "Add a note so they know what to fix.",
        }),
      ])
    }
  )

  it("caps the note at the database's 5,000 characters, once trimmed", () => {
    expect(REVISION_NOTE_MAX).toBe(5000)
    expect(
      taskSendBackSchema.safeParse({
        taskId: TASK_ID,
        note: `  ${"x".repeat(5000)}  `,
      }).success
    ).toBe(true)
    expect(
      taskSendBackSchema.safeParse({ taskId: TASK_ID, note: "x".repeat(5001) })
        .success
    ).toBe(false)
  })

  it("refuses a task id that isn't a UUID", () => {
    expect(
      taskSendBackSchema.safeParse({ taskId: "abc", note: "Fix" }).success
    ).toBe(false)
  })
})

describe("taskDeleteSchema", () => {
  it.each([
    "2026-10-30T02:15:42.123456+00:00",
    "2026-10-30T02:15:42+00:00",
    "2026-10-30T10:15:42.1+08:00",
    "2026-10-30T02:15:42.123456Z",
  ])("keeps the version %j as the same string", (version) => {
    expect(
      taskDeleteSchema.parse({ taskId: TASK_ID, expectedUpdatedAt: version })
    ).toEqual({ taskId: TASK_ID, expectedUpdatedAt: version })
  })

  it.each([
    ["no version", undefined],
    ["a null version", null],
    ["a version without an offset", "2026-10-30T02:15:42.123456"],
    ["a date only", "2026-10-30"],
    ["a Postgres-style timestamp", "2026-10-30 02:15:42+00"],
    ["text", "yesterday"],
  ])("refuses %s", (_name, version) => {
    expect(
      taskDeleteSchema.safeParse({
        taskId: TASK_ID,
        expectedUpdatedAt: version,
      }).success
    ).toBe(false)
  })

  it("refuses a task id that isn't a UUID", () => {
    expect(
      taskDeleteSchema.safeParse({
        taskId: "abc",
        expectedUpdatedAt: "2026-10-30T02:15:42+00:00",
      }).success
    ).toBe(false)
  })
})

describe("taskUpdateSchema", () => {
  const MEMBER = "00000000-0000-4000-8000-000000000001"
  const OTHER = "00000000-0000-4000-8000-000000000002"
  const EDIT = {
    taskId: TASK_ID,
    title: "Lay out the spread",
    description: null,
    dueAt: "2026-10-31T23:30",
    referenceUrl: null,
    slots: [
      {
        id: SLOT_ID,
        loadedMemberId: MEMBER,
        role: "layout_artist" as const,
        memberId: MEMBER,
      },
      { role: "writer" as const, memberId: OTHER },
    ],
  }

  function updateIssues(input: unknown) {
    const result = taskUpdateSchema.safeParse(input)
    return result.success ? [] : result.error.issues
  }

  it("accepts the task, its fields, and slots with an id and the member it loaded (existing) or neither (new)", () => {
    expect(taskUpdateSchema.parse(EDIT)).toEqual(EDIT)
  })

  it.each([
    [
      "an existing slot without the member it loaded",
      [{ id: SLOT_ID, role: "writer", memberId: MEMBER }],
    ],
    [
      "a new slot with a loaded member",
      [{ loadedMemberId: MEMBER, role: "writer", memberId: MEMBER }],
    ],
  ])("refuses %s", (_name, slots) => {
    expect(
      updateIssues({ ...EDIT, slots }).some(
        (issue) => issue.path.join(".") === "slots.0.loadedMemberId"
      )
    ).toBe(true)
  })

  it("refuses a loaded member that isn't a UUID", () => {
    expect(
      updateIssues({
        ...EDIT,
        slots: [
          {
            id: SLOT_ID,
            loadedMemberId: "abc",
            role: "writer",
            memberId: MEMBER,
          },
        ],
      }).some((issue) => issue.path.join(".") === "slots.0.loadedMemberId")
    ).toBe(true)
  })

  it("has no owner: one passed along is dropped", () => {
    expect(
      taskUpdateSchema.parse({
        ...EDIT,
        owningSectionId: "news",
        owningDeskId: null,
      })
    ).toEqual(EDIT)
  })

  it("trims the title and the reference link, as create does", () => {
    const parsed = taskUpdateSchema.parse({
      ...EDIT,
      title: "  Lay out the spread  ",
      referenceUrl: " https://example.com/brief ",
    })
    expect(parsed.title).toBe("Lay out the spread")
    expect(parsed.referenceUrl).toBe("https://example.com/brief")
  })

  it.each([
    ["a task id that isn't a UUID", { taskId: "abc" }, "taskId"],
    ["no task id", { taskId: undefined }, "taskId"],
    ["a blank title", { title: "   " }, "title"],
    ["a title over 200 characters", { title: "x".repeat(201) }, "title"],
    [
      "a description over 5000 characters",
      { description: "x".repeat(5001) },
      "description",
    ],
    ["a malformed due date", { dueAt: "2026-10-31" }, "dueAt"],
    [
      "a malformed reference link",
      { referenceUrl: "not-a-url" },
      "referenceUrl",
    ],
    ["no slots", { slots: [] }, "slots"],
    [
      "a slot id that isn't a UUID",
      {
        slots: [
          {
            id: "abc",
            loadedMemberId: MEMBER,
            role: "writer",
            memberId: MEMBER,
          },
        ],
      },
      "slots.0.id",
    ],
    [
      "a slot with an invalid role",
      {
        slots: [
          {
            id: SLOT_ID,
            loadedMemberId: MEMBER,
            role: "editor",
            memberId: MEMBER,
          },
        ],
      },
      "slots.0.role",
    ],
    [
      "a slot whose memberId isn't a UUID",
      { slots: [{ role: "writer", memberId: "" }] },
      "slots.0.memberId",
    ],
  ])("refuses %s, as create does", (_name, change, path) => {
    expect(
      updateIssues({ ...EDIT, ...change }).some(
        (issue) => issue.path.join(".") === path
      )
    ).toBe(true)
  })

  it.each([
    [
      "an existing slot and a new one",
      [
        {
          id: SLOT_ID,
          loadedMemberId: MEMBER,
          role: "writer",
          memberId: MEMBER,
        },
        { role: "writer", memberId: MEMBER },
      ],
    ],
    [
      "two new slots",
      [
        { role: "writer", memberId: MEMBER },
        { role: "writer", memberId: MEMBER },
      ],
    ],
  ])(
    "refuses %s with the same role and member, inline on the slots",
    (_name, slots) => {
      expect(
        updateIssues({ ...EDIT, slots }).some(
          (issue) =>
            issue.path.join(".") === "slots" &&
            issue.message ===
              "The same member already has that role — remove one"
        )
      ).toBe(true)
    }
  )

  it("accepts two same-role slots trading members", () => {
    expect(
      taskUpdateSchema.safeParse({
        ...EDIT,
        slots: [
          {
            id: SLOT_ID,
            loadedMemberId: MEMBER,
            role: "writer",
            memberId: OTHER,
          },
          {
            id: "00000000-0000-4000-8000-000000000012",
            loadedMemberId: OTHER,
            role: "writer",
            memberId: MEMBER,
          },
        ],
      }).success
    ).toBe(true)
  })
})

describe("slotReassignSchema", () => {
  const REASSIGN = {
    slotId: SLOT_ID,
    memberId: "00000000-0000-4000-8000-000000000001",
    expectedUpdatedAt: "2026-10-30T02:15:42.123456+00:00",
  }

  it("accepts the slot, the member and the version, keeping the version's string as given", () => {
    expect(slotReassignSchema.parse(REASSIGN)).toEqual(REASSIGN)
  })

  it.each([
    ["a slot id that isn't a UUID", { slotId: "abc" }],
    ["no member", { memberId: undefined }],
    ["a member id that isn't a UUID", { memberId: "x" }],
    ["no version", { expectedUpdatedAt: undefined }],
    [
      "a version without an offset",
      { expectedUpdatedAt: "2026-10-30T02:15:42" },
    ],
    ["a version that isn't a timestamp", { expectedUpdatedAt: "now" }],
  ])("refuses %s", (_name, change) => {
    expect(
      slotReassignSchema.safeParse({ ...REASSIGN, ...change }).success
    ).toBe(false)
  })
})

// Story 3.9: text Postgres can't store (22P05) is refused inline, before any
// action runs.
describe("characters that can't be saved", () => {
  const UNSAVABLE = "This has a character that can't be saved — remove it."
  const BAD = [
    ["U+0000", "a\u0000b"],
    ["a lone high surrogate", "\uD800"],
    ["a lone low surrogate", "x\uDC00y"],
    ["a pair in the wrong order", "\uDE00\uD83D"],
    ["U+0000 between spaces that trim removes", "  a\u0000b  "],
  ] as const
  const EMOJI = "Done 😀"

  const EDIT = {
    taskId: TASK_ID,
    title: "Lay out the spread",
    description: null,
    dueAt: "2026-10-31T23:30",
    referenceUrl: null,
    slots: [{ role: "writer" as const, memberId: VALID.slots[0].memberId }],
  }

  // A link holding the value: spaces inside it become dashes (a link has
  // none), and the ones around it stay, for trim.
  const asLink = (value: string) => {
    const inner = value.trim()
    return value.replace(
      inner,
      `https://example.com/${inner.replaceAll(" ", "-")}`
    )
  }

  // Each field, with the value put where that schema reads it.
  const FIELDS = [
    [
      "the create title",
      taskCreateSchema,
      (v: string) => ({ ...VALID, title: v }),
      "title",
    ],
    [
      "the create description",
      taskCreateSchema,
      (v: string) => ({ ...VALID, description: v }),
      "description",
    ],
    [
      "the create reference link",
      taskCreateSchema,
      (v: string) => ({ ...VALID, referenceUrl: asLink(v) }),
      "referenceUrl",
    ],
    [
      "the edit title",
      taskUpdateSchema,
      (v: string) => ({ ...EDIT, title: v }),
      "title",
    ],
    [
      "the edit description",
      taskUpdateSchema,
      (v: string) => ({ ...EDIT, description: v }),
      "description",
    ],
    [
      "the edit reference link",
      taskUpdateSchema,
      (v: string) => ({ ...EDIT, referenceUrl: asLink(v) }),
      "referenceUrl",
    ],
    [
      "the Can't take this reason",
      slotRespondSchema,
      (v: string) => ({
        slotId: SLOT_ID,
        response: "needs_reassignment",
        reason: v,
      }),
      "reason",
    ],
    [
      "the hand-back reason",
      slotHandBackSchema,
      (v: string) => ({ slotId: SLOT_ID, reason: v }),
      "reason",
    ],
    [
      "the send-back note",
      taskSendBackSchema,
      (v: string) => ({ taskId: TASK_ID, note: v }),
      "note",
    ],
  ] as const

  describe.each(FIELDS)("%s", (_field, schema, input, path) => {
    it.each(BAD)(
      "refuses %s with the inline copy, on the field alone",
      (_name, value) => {
        const result = schema.safeParse(input(value))
        expect(result.success).toBe(false)
        expect(result.error?.issues).toEqual([
          expect.objectContaining({ path: [path], message: UNSAVABLE }),
        ])
      }
    )

    it("accepts an emoji, a valid surrogate pair", () => {
      expect(schema.safeParse(input(EMOJI)).success).toBe(true)
    })
  })

  it("keeps the emoji as typed", () => {
    expect(taskCreateSchema.parse({ ...VALID, title: EMOJI }).title).toBe(EMOJI)
    expect(
      slotHandBackSchema.parse({ slotId: SLOT_ID, reason: EMOJI }).reason
    ).toBe(EMOJI)
    expect(
      taskSendBackSchema.parse({ taskId: TASK_ID, note: EMOJI }).note
    ).toBe(EMOJI)
  })
})

describe("slots with no member yet", () => {
  const EMPTY = { role: "writer" as const, memberId: "" }

  it("shows Choose a member, not zod's Invalid UUID", () => {
    expect(issuesFor({ ...VALID, slots: [EMPTY] })).toEqual([
      expect.objectContaining({
        path: ["slots", 0, "memberId"],
        message: "Choose a member",
      }),
    ])
  })

  it.each([
    ["create", taskCreateSchema, VALID],
    [
      "edit",
      taskUpdateSchema,
      {
        taskId: TASK_ID,
        title: "Lay out the spread",
        description: null,
        dueAt: "2026-10-31T23:30",
        referenceUrl: null,
      },
    ],
  ] as const)(
    "gives two empty slots Choose a member each, and no repeated-pair error, on %s",
    (_mode, schema, fields) => {
      const result = schema.safeParse({ ...fields, slots: [EMPTY, EMPTY] })
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["slots", 0, "memberId"],
          message: "Choose a member",
        }),
        expect.objectContaining({
          path: ["slots", 1, "memberId"],
          message: "Choose a member",
        }),
      ])
    }
  )

  it("doesn't pair an empty slot with a chosen one of the same role", () => {
    const issues = issuesFor({
      ...VALID,
      slots: [{ role: "writer", memberId: VALID.slots[0].memberId }, EMPTY],
    })
    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "slots.1.memberId",
    ])
  })

  it("still refuses a real pair: the same role and member twice", () => {
    const pair = { role: "writer" as const, memberId: VALID.slots[0].memberId }
    expect(issuesFor({ ...VALID, slots: [pair, pair, EMPTY] })).toEqual([
      expect.objectContaining({
        path: ["slots", 2, "memberId"],
        message: "Choose a member",
      }),
      expect.objectContaining({
        path: ["slots"],
        message: "The same member already has that role — remove one",
      }),
    ])
  })
})
