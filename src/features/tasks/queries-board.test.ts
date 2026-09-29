import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// queries.ts imports through @/features/members, whose index.ts also pulls in
// actions.ts (env.client).
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { getBoard, getBoardOwners } from "./queries"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const ME = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000a2"

const TASKS = [
  {
    id: T1,
    title: "First",
    due_at: "2026-01-01T00:00:00+00:00",
    column: "doing",
    sections: { name: "News" },
    desks: null,
    task_assignments: [
      { member_id: ME, state: "on_it" },
      { member_id: OTHER, state: "awaiting_response" },
      { member_id: ME, state: "needs_reassignment" },
    ],
  },
  {
    id: T2,
    title: "Second",
    due_at: "2099-01-01T00:00:00+00:00",
    column: "to_do",
    sections: null,
    desks: { name: "Layout" },
    task_assignments: [{ member_id: "gone", state: "on_it" }],
  },
]

type Fixture = {
  tasks?: unknown
  tasksError?: unknown
  capabilities?: unknown
  capabilitiesError?: unknown
  directory?: unknown
  directoryError?: unknown
}

function mockBoard(fixture: Fixture = {}) {
  const taskCalls: Call[] = []
  const directoryCalls: Call[] = []
  const rpc = vi.fn(async (name: string, args: unknown) => {
    expect(name).toBe("task_capabilities")
    void args
    return {
      data: fixture.capabilities ?? [
        {
          task_id: T1,
          allowed_moves: ["to_do", "for_review"],
          respondable_slot_ids: [],
        },
      ],
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
        data: fixture.directory ?? [
          { id: ME, name: "Sam Layout" },
          { id: OTHER, name: "Olive Writer" },
        ],
        error: fixture.directoryError ?? null,
      }))
    }
    throw new Error(`unexpected table: ${table}`)
  })
  createClient.mockResolvedValue({ from, rpc })
  return { taskCalls, directoryCalls, rpc, from }
}

describe("getBoard", () => {
  it.each([
    [
      { kind: "section", id: "news" } as const,
      "eq",
      ["owning_section_id", "news"],
    ],
    [
      { kind: "desk", id: "layout" } as const,
      "eq",
      ["owning_desk_id", "layout"],
    ],
    [{ kind: "articles" } as const, "not", ["owning_section_id", "is", null]],
  ])("filters %j with .%s", async (filter, method, args) => {
    const { taskCalls } = mockBoard()

    await getBoard(filter)

    expect(taskCalls.filter((call) => call.method === method)).toEqual([
      { method, args },
    ])
  })

  it("applies no owner filter for All", async () => {
    const { taskCalls } = mockBoard()

    await getBoard({ kind: "all" })

    expect(
      taskCalls.filter((call) => call.method === "eq" || call.method === "not")
    ).toEqual([])
  })

  it("orders tasks by due date then id, and embedded slots by created_at then id", async () => {
    const { taskCalls } = mockBoard()

    await getBoard({ kind: "all" })

    expect(taskCalls.filter((call) => call.method === "order")).toEqual([
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

  it("returns [] with no further query when no task matches", async () => {
    const { rpc, directoryCalls } = mockBoard({ tasks: [] })

    await expect(getBoard({ kind: "all" })).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(directoryCalls).toEqual([])
  })

  it("builds cards with allowedMoves from task_capabilities and nothing else", async () => {
    const { rpc, directoryCalls } = mockBoard()

    const cards = await getBoard({ kind: "all" })

    expect(rpc).toHaveBeenCalledWith("task_capabilities", { ids: [T1, T2] })
    // The whole directory, never an .in() list of ids that could outgrow a URL.
    expect(directoryCalls).toEqual([{ method: "select", args: ["id, name"] }])
    expect(cards).toEqual([
      {
        id: T1,
        title: "First",
        ownerName: "News",
        dueAt: "2026-01-01T00:00:00+00:00",
        column: "doing",
        overdue: true,
        hasAwaitingResponse: true,
        hasNeedsReassignment: true,
        assignees: [
          { id: ME, name: "Sam Layout", initials: "SL" },
          { id: OTHER, name: "Olive Writer", initials: "OW" },
        ],
        allowedMoves: ["to_do", "for_review"],
      },
      {
        id: T2,
        title: "Second",
        ownerName: "Layout",
        dueAt: "2099-01-01T00:00:00+00:00",
        column: "to_do",
        overdue: false,
        hasAwaitingResponse: false,
        hasNeedsReassignment: false,
        assignees: [{ id: "gone", name: "Former member", initials: "FM" }],
        // No capabilities row: nothing to offer.
        allowedMoves: [],
      },
    ])
  })

  it.each([
    ["tasks", { tasksError: { message: "x" } }],
    ["task_capabilities", { capabilitiesError: { message: "x" } }],
    ["member_directory", { directoryError: { message: "x" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockBoard(fixture)

    await expect(getBoard({ kind: "all" })).rejects.toThrow(
      `getBoard: reading ${name} failed`
    )
  })
})

describe("getBoardOwners", () => {
  function mockOwners(errors: { sections?: unknown; desks?: unknown } = {}) {
    const data: Record<string, unknown[]> = {
      sections: [
        { id: "news", name: "News" },
        { id: "sports", name: "Sports" },
      ],
      desks: [
        { id: "writers", name: "Writers" },
        { id: "layout", name: "Layout" },
      ],
    }
    createClient.mockResolvedValue({
      from: (table: string) => {
        const builder = {
          select: () => builder,
          order: () => builder,
          then: (resolve: (value: unknown) => void) =>
            resolve({
              data: data[table],
              error: errors[table as "sections" | "desks"] ?? null,
            }),
        }
        return builder
      },
    })
  }

  it("lists sections then desks, without Writers", async () => {
    mockOwners()

    await expect(getBoardOwners()).resolves.toEqual([
      { kind: "section", id: "news", name: "News" },
      { kind: "section", id: "sports", name: "Sports" },
      { kind: "desk", id: "layout", name: "Layout" },
    ])
  })

  it.each(["sections", "desks"] as const)(
    "throws when reading %s fails",
    async (table) => {
      mockOwners({ [table]: { message: "x" } })

      await expect(getBoardOwners()).rejects.toThrow(
        `getBoardOwners: reading ${table} failed`
      )
    }
  )
})
