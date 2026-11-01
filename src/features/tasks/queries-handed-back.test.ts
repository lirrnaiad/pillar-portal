import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient, getCurrentMember } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentMember: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// The viewer, as the members barrel re-exports it; the rest of the slice
// (PRODUCTION_ROLE_LABELS for the rows) stays real.
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
  countHandedBackForViewer,
  getHandedBackForViewer,
  getHandedBackQueue,
} from "./queries/handed-back"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const T3 = "00000000-0000-4000-8000-0000000000b3"
const S1 = "00000000-0000-4000-8000-0000000000c1"
const S2 = "00000000-0000-4000-8000-0000000000c2"
const S3 = "00000000-0000-4000-8000-0000000000c3"
const S4 = "00000000-0000-4000-8000-0000000000c4"
const LAYOUT = "00000000-0000-4000-8000-0000000000a1"
const WRITER = "00000000-0000-4000-8000-0000000000a2"
const GONE = "00000000-0000-4000-8000-0000000000a3"

// As PostgREST returns them, microseconds included.
const V1 = "2026-11-01T02:15:42.123456+00:00"
const V2 = "2026-11-01T03:15:42.654321+00:00"
const V3 = "2026-11-01T04:15:42.000001+00:00"
const V4 = "2026-11-01T05:15:42.999999+00:00"

// The tasks as the database returns them: soonest due first, each with only
// its handed-back slots, in slot order, each slot with its reason embedded
// (one row or none). T1 is a Layout task with two, the second handed back
// without a reason; T2 a News task; T3 another Layout task whose slot's
// member has left.
const TASKS = [
  {
    id: T1,
    title: "Lay out the spread",
    due_at: "2099-01-01T00:00:00+00:00",
    task_assignments: [
      {
        id: S1,
        role: "layout_artist",
        member_id: LAYOUT,
        updated_at: V1,
        assignment_reasons: { reason: "Out sick this week" },
      },
      {
        id: S2,
        role: "cartoonist",
        member_id: WRITER,
        updated_at: V2,
        assignment_reasons: null,
      },
    ],
  },
  {
    id: T2,
    title: "Write the story",
    due_at: "2099-01-02T00:00:00+00:00",
    task_assignments: [
      {
        id: S3,
        role: "writer",
        member_id: WRITER,
        updated_at: V3,
        assignment_reasons: { reason: "Not my beat" },
      },
    ],
  },
  {
    id: T3,
    title: "Draw the strip",
    due_at: "2099-01-03T00:00:00+00:00",
    task_assignments: [
      {
        id: S4,
        role: "cartoonist",
        member_id: GONE,
        updated_at: V4,
        assignment_reasons: { reason: "Member deactivated" },
      },
    ],
  },
]

const capabilities = (
  taskId: string,
  canReassign: boolean,
  canManage = canReassign
) => ({
  task_id: taskId,
  allowed_moves: [],
  respondable_slot_ids: [],
  hand_back_slot_ids: [],
  can_review: false,
  can_reopen: false,
  can_manage: canManage,
  can_reassign: canReassign,
})

// The Head Layout Artist: the Layout tasks, not News's. Returned out of
// order: the tasks' order is the one that counts.
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

function mockRead(fixture: Fixture = {}) {
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
    for (const method of ["select", "order", "eq", "neq", "not", "in"]) {
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
      // GONE has left, so the directory doesn't list them.
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

const NOT_APPROVERS = [
  ["signed out", null],
  ["active staff", { ...ACTIVE_ADMIN, role: "staff" }],
  ["pending", { ...ACTIVE_ADMIN, role: "pending", state: "pending" }],
  ["declined", { ...ACTIVE_ADMIN, role: "pending", state: "declined" }],
  ["a deactivated former admin", { ...ACTIVE_ADMIN, state: "deactivated" }],
] as const

describe("getHandedBackQueue", () => {
  it("sends both filters in the query: the handed-back slots (inner-joined, each with its reason embedded) of tasks that aren't Done, soonest due first, slots in slot order", async () => {
    const { taskCalls } = mockRead()

    await getHandedBackQueue()

    expect(taskCalls).toEqual([
      {
        method: "select",
        args: [
          "id, title, due_at, task_assignments!inner(id, role, member_id, updated_at, assignment_reasons(reason))",
        ],
      },
      { method: "eq", args: ["task_assignments.state", "needs_reassignment"] },
      { method: "neq", args: ["column", "done"] },
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
    ])
  })

  it("keeps the tasks whose can_reassign is true, one row per slot in the read's order, with names, labels and reasons", async () => {
    const { rpc, from, directoryCalls } = mockRead()

    const queue = await getHandedBackQueue()

    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [T1, T2, T3],
    })
    // The whole directory, never an .in() list of ids that could outgrow a URL.
    expect(directoryCalls).toEqual([{ method: "select", args: ["id, name"] }])
    // The reasons came embedded: no read of their own, no slot ids in a URL.
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "tasks",
      "member_directory",
    ])
    expect(queue).toEqual([
      {
        slotId: S1,
        slotUpdatedAt: V1,
        taskId: T1,
        taskTitle: "Lay out the spread",
        dueAt: "2099-01-01T00:00:00+00:00",
        role: "layout_artist",
        roleLabel: "Layout Artist",
        memberId: LAYOUT,
        memberName: "Sam Layout",
        reason: "Out sick this week",
      },
      {
        slotId: S2,
        slotUpdatedAt: V2,
        taskId: T1,
        taskTitle: "Lay out the spread",
        dueAt: "2099-01-01T00:00:00+00:00",
        role: "cartoonist",
        roleLabel: "Cartoonist",
        memberId: WRITER,
        memberName: "Olive Writer",
        // No reason given: its embed is null.
        reason: null,
      },
      {
        slotId: S4,
        slotUpdatedAt: V4,
        taskId: T3,
        taskTitle: "Draw the strip",
        dueAt: "2099-01-03T00:00:00+00:00",
        role: "cartoonist",
        roleLabel: "Cartoonist",
        memberId: GONE,
        // Not in the directory.
        memberName: "Former member",
        reason: "Member deactivated",
      },
    ])
  })

  it("lists every handed-back slot, soonest due first, for a viewer who may reassign them all (a top editor)", async () => {
    mockRead({
      capabilities: [T1, T2, T3].map((id) => capabilities(id, true)),
    })

    const queue = await getHandedBackQueue()

    expect(queue.map((row) => row.slotId)).toEqual([S1, S2, S3, S4])
  })

  it("leaves out a task whose can_manage is true but can_reassign false (a Done one, say): the filter reads can_reassign", async () => {
    mockRead({
      capabilities: [
        capabilities(T1, true),
        capabilities(T2, false, true),
        capabilities(T3, false, true),
      ],
    })

    const queue = await getHandedBackQueue()

    expect(queue.map((row) => row.slotId)).toEqual([S1, S2])
  })

  it("passes the slot's version through untouched", async () => {
    mockRead()

    const [first] = await getHandedBackQueue()

    expect(first.slotUpdatedAt).toBe("2026-11-01T02:15:42.123456+00:00")
  })

  it("returns [] with no further query when no slot is handed back", async () => {
    const { rpc, directoryCalls } = mockRead({ tasks: [] })

    await expect(getHandedBackQueue()).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(directoryCalls).toEqual([])
  })

  it("returns [] without reading names when the viewer may reassign none", async () => {
    const { directoryCalls } = mockRead({
      capabilities: [T1, T2, T3].map((id) => capabilities(id, false)),
    })

    await expect(getHandedBackQueue()).resolves.toEqual([])
    expect(directoryCalls).toEqual([])
  })

  it.each([
    ["tasks", { tasksError: { message: "x" } }],
    ["task_capabilities", { capabilitiesError: { message: "x" } }],
    ["member_directory", { directoryError: { message: "x" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockRead(fixture)

    await expect(getHandedBackQueue()).rejects.toThrow(
      `getHandedBackQueue: reading ${name} failed`
    )
  })
})

describe("getHandedBackForViewer", () => {
  it("returns the queue's rows for an active editorial_admin", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    mockRead()

    const rows = await getHandedBackForViewer()
    const queue = await getHandedBackQueue()

    expect(rows).toEqual(queue)
    expect(rows.map((row) => row.slotId)).toEqual([S1, S2, S4])
  })

  it.each(NOT_APPROVERS)(
    "returns [] for a viewer who is %s, without a query",
    async (_label, member) => {
      getCurrentMember.mockResolvedValue(member)
      const { from, rpc } = mockRead()

      await expect(getHandedBackForViewer()).resolves.toEqual([])
      expect(createClient).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["tasks", { tasksError: { message: "x" } }],
    ["task_capabilities", { capabilitiesError: { message: "x" } }],
    ["member_directory", { directoryError: { message: "x" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    mockRead(fixture)

    await expect(getHandedBackForViewer()).rejects.toThrow(
      `getHandedBackForViewer: reading ${name} failed`
    )
  })
})

describe("countHandedBackForViewer", () => {
  it("counts the slots the queue shows, for an active editorial_admin, without names", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    const { rpc, taskCalls, directoryCalls } = mockRead()

    await expect(countHandedBackForViewer()).resolves.toBe(3)
    expect(taskCalls).toContainEqual({
      method: "eq",
      args: ["task_assignments.state", "needs_reassignment"],
    })
    expect(taskCalls).toContainEqual({
      method: "neq",
      args: ["column", "done"],
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [T1, T2, T3],
    })
    expect(directoryCalls).toEqual([])
  })

  it.each([
    ["the Head Layout Artist", HEAD_LAYOUT_CAPABILITIES],
    ["a top editor", [T1, T2, T3].map((id) => capabilities(id, true))],
    [
      "an admin who approves none",
      [T1, T2, T3].map((id) => capabilities(id, false)),
    ],
    [
      "a viewer who may manage T2 and T3 but reassign only T1",
      [
        capabilities(T1, true),
        capabilities(T2, false, true),
        capabilities(T3, false, true),
      ],
    ],
  ])("matches getHandedBackQueue's length for %s", async (_label, caps) => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    mockRead({ capabilities: caps })

    const count = await countHandedBackForViewer()
    const queue = await getHandedBackQueue()

    expect(count).toBe(queue.length)
  })

  it("returns 0 when no slot is handed back, without task_capabilities", async () => {
    getCurrentMember.mockResolvedValue(ACTIVE_ADMIN)
    const { rpc } = mockRead({ tasks: [] })

    await expect(countHandedBackForViewer()).resolves.toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(NOT_APPROVERS)(
    "returns 0 for a viewer who is %s, without a query",
    async (_label, member) => {
      getCurrentMember.mockResolvedValue(member)
      const { from, rpc } = mockRead()

      await expect(countHandedBackForViewer()).resolves.toBe(0)
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
    mockRead(fixture)

    await expect(countHandedBackForViewer()).rejects.toThrow(
      `countHandedBackForViewer: reading ${name} failed`
    )
  })

  it("throws when reading the viewer fails", async () => {
    getCurrentMember.mockRejectedValue(new Error("getCurrentMember: x"))
    mockRead()

    await expect(countHandedBackForViewer()).rejects.toThrow(
      "getCurrentMember: x"
    )
  })
})
