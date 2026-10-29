import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient, getCurrentMember } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentMember: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// The viewer, as the members barrel re-exports it; the rest of the slice
// (initialsOf for the cards) stays real.
vi.mock("@/features/members/queries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentMember,
}))
// The members barrel's index.ts also pulls in actions.ts, which reads the
// server-only env, and env.client; these tests use neither.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({}))

import {
  countReviewQueueForViewer,
  getReviewQueue,
} from "./queries/review-queue"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const T3 = "00000000-0000-4000-8000-0000000000b3"
const LAYOUT = "00000000-0000-4000-8000-0000000000a1"
const WRITER = "00000000-0000-4000-8000-0000000000a2"

// The For Review tasks as the database returns them: soonest due first.
const TASKS = [
  {
    id: T1,
    title: "Lay out the spread",
    due_at: "2099-01-01T00:00:00+00:00",
    column: "for_review",
    revision_note_at: null,
    sections: null,
    desks: { name: "Layout" },
    task_assignments: [{ member_id: LAYOUT, state: "on_it" }],
  },
  {
    id: T2,
    title: "Write the column",
    due_at: "2099-01-02T00:00:00+00:00",
    column: "for_review",
    revision_note_at: null,
    sections: { name: "Opinion" },
    desks: null,
    task_assignments: [{ member_id: WRITER, state: "on_it" }],
  },
  {
    id: T3,
    title: "Draw the strip",
    due_at: "2099-01-03T00:00:00+00:00",
    column: "for_review",
    revision_note_at: null,
    sections: null,
    desks: { name: "Layout" },
    task_assignments: [
      { member_id: WRITER, state: "on_it" },
      { member_id: LAYOUT, state: "on_it" },
    ],
  },
]

const capabilities = (taskId: string, canReview: boolean) => ({
  task_id: taskId,
  allowed_moves: [],
  respondable_slot_ids: [],
  hand_back_slot_ids: [],
  can_review: canReview,
  can_reopen: false,
})

// A Head Layout Artist: the Layout tasks, and not Opinion's (top editors
// only). Returned out of order: the tasks' order is the one that counts.
const HEAD_LAYOUT_CAPABILITIES = [
  capabilities(T3, true),
  capabilities(T2, false),
  capabilities(T1, true),
]

type Fixture = {
  tasks?: unknown
  tasksError?: unknown
  capabilities?: unknown
  capabilitiesError?: unknown
  directoryError?: unknown
}

function mockQueue(fixture: Fixture = {}) {
  const taskCalls: Call[] = []
  const directoryCalls: Call[] = []
  const rpc = vi.fn(async (name: string, args: unknown) => {
    expect(name).toBe("task_capabilities")
    void args
    return {
      data: fixture.capabilities ?? HEAD_LAYOUT_CAPABILITIES,
      error: fixture.capabilitiesError ?? null,
    }
  })
  const recorder = (calls: Call[], result: () => unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "order", "eq", "not", "in"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => void) => resolve(result())
    return builder
  }
  const from = vi.fn((table: string) => {
    if (table === "tasks") {
      return recorder(taskCalls, () => ({
        data: fixture.tasks ?? TASKS,
        error: fixture.tasksError ?? null,
      }))
    }
    if (table === "member_directory") {
      return recorder(directoryCalls, () => ({
        data: [
          { id: LAYOUT, name: "Sam Layout" },
          { id: WRITER, name: "Olive Writer" },
        ],
        error: fixture.directoryError ?? null,
      }))
    }
    throw new Error(`unexpected table: ${table}`)
  })
  createClient.mockResolvedValue({ from, rpc })
  return { taskCalls, directoryCalls, rpc, from }
}

const ACTIVE_ADMIN = {
  id: LAYOUT,
  name: "Hana Head",
  role: "editorial_admin",
  state: "active",
}

describe("getReviewQueue", () => {
  it("reads the For Review tasks as cards, soonest due first, with slots in slot order", async () => {
    const { taskCalls } = mockQueue()

    await getReviewQueue()

    expect(taskCalls).toEqual([
      {
        method: "select",
        args: [
          "id, title, due_at, column, revision_note_at, sections(name), desks(name), task_assignments(member_id, state)",
        ],
      },
      { method: "order", args: ["due_at"] },
      { method: "order", args: ["id"] },
      {
        method: "order",
        args: ["created_at", { referencedTable: "task_assignments" }],
      },
      {
        method: "order",
        args: ["id", { referencedTable: "task_assignments" }],
      },
      { method: "eq", args: ["column", "for_review"] },
    ])
  })

  it("keeps the tasks whose can_review is true, in the tasks' order, as cards with names", async () => {
    const { rpc, directoryCalls } = mockQueue()

    const queue = await getReviewQueue()

    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [T1, T2, T3],
    })
    // The whole directory, never an .in() list of ids that could outgrow a URL.
    expect(directoryCalls).toEqual([{ method: "select", args: ["id, name"] }])
    expect(queue).toEqual([
      {
        id: T1,
        title: "Lay out the spread",
        ownerName: "Layout",
        dueAt: "2099-01-01T00:00:00+00:00",
        column: "for_review",
        overdue: false,
        sentBack: false,
        hasAwaitingResponse: false,
        hasNeedsReassignment: false,
        assignees: [{ id: LAYOUT, name: "Sam Layout", initials: "SL" }],
      },
      {
        id: T3,
        title: "Draw the strip",
        ownerName: "Layout",
        dueAt: "2099-01-03T00:00:00+00:00",
        column: "for_review",
        overdue: false,
        sentBack: false,
        hasAwaitingResponse: false,
        hasNeedsReassignment: false,
        assignees: [
          { id: WRITER, name: "Olive Writer", initials: "OW" },
          { id: LAYOUT, name: "Sam Layout", initials: "SL" },
        ],
      },
    ])
  })

  it("lists every For Review task for a viewer who may review them all (a top editor)", async () => {
    mockQueue({
      capabilities: [T1, T2, T3].map((id) => capabilities(id, true)),
    })

    const queue = await getReviewQueue()

    expect(queue.map((task) => task.id)).toEqual([T1, T2, T3])
  })

  it("returns [] with no further query when no task is For Review", async () => {
    const { rpc, directoryCalls } = mockQueue({ tasks: [] })

    await expect(getReviewQueue()).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(directoryCalls).toEqual([])
  })

  it("returns [] without reading names when the viewer may review none", async () => {
    const { directoryCalls } = mockQueue({
      capabilities: [T1, T2, T3].map((id) => capabilities(id, false)),
    })

    await expect(getReviewQueue()).resolves.toEqual([])
    expect(directoryCalls).toEqual([])
  })

  it.each([
    ["tasks", { tasksError: { message: "x" } }],
    ["task_capabilities", { capabilitiesError: { message: "x" } }],
    ["member_directory", { directoryError: { message: "x" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockQueue(fixture)

    await expect(getReviewQueue()).rejects.toThrow(
      `getReviewQueue: reading ${name} failed`
    )
  })
})

describe("countReviewQueueForViewer", () => {
  it("counts the same rows the queue shows, for an active editorial_admin", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    const { rpc, taskCalls, directoryCalls } = mockQueue()

    await expect(countReviewQueueForViewer()).resolves.toBe(2)
    expect(taskCalls).toContainEqual({
      method: "eq",
      args: ["column", "for_review"],
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [T1, T2, T3],
    })
    // A count needs no names.
    expect(directoryCalls).toEqual([])
  })

  it("matches getReviewQueue's length", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    mockQueue()

    const count = await countReviewQueueForViewer()
    const queue = await getReviewQueue()

    expect(count).toBe(queue.length)
  })

  it("returns 0 when nothing is For Review, without task_capabilities", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    const { rpc } = mockQueue({ tasks: [] })

    await expect(countReviewQueueForViewer()).resolves.toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["signed out", null],
    ["active staff", { ...ACTIVE_ADMIN, role: "staff" }],
    ["pending", { ...ACTIVE_ADMIN, role: "pending", state: "pending" }],
    ["declined", { ...ACTIVE_ADMIN, role: "pending", state: "declined" }],
    ["a deactivated former admin", { ...ACTIVE_ADMIN, state: "deactivated" }],
  ])(
    "returns 0 for a viewer who is %s, without a query",
    async (_label, member) => {
      getCurrentMember.mockResolvedValue(member)
      const { from, rpc } = mockQueue()

      await expect(countReviewQueueForViewer()).resolves.toBe(0)
      expect(createClient).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["tasks", { tasksError: { message: "x" } }],
    ["task_capabilities", { capabilitiesError: { message: "x" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    mockQueue(fixture)

    await expect(countReviewQueueForViewer()).rejects.toThrow(
      `countReviewQueueForViewer: reading ${name} failed`
    )
  })

  it("throws when reading the viewer fails", async () => {
    getCurrentMember.mockRejectedValue(new Error("getCurrentMember: x"))
    mockQueue()

    await expect(countReviewQueueForViewer()).rejects.toThrow(
      "getCurrentMember: x"
    )
  })
})
