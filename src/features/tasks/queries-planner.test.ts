import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// queries.ts imports through @/features/members, whose index.ts also pulls in
// actions.ts (env.client).
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { getPlanner } from "./queries"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const T3 = "00000000-0000-4000-8000-0000000000b3"
const ME = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000a2"

const task = (
  id: string,
  dueAt: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  title: `Task ${id.slice(-2)}`,
  due_at: dueAt,
  column: "to_do",
  sections: null,
  desks: { name: "Layout" },
  task_assignments: [{ member_id: ME, state: "on_it" }],
  ...extra,
})

type Fixture = {
  openSlots?: unknown[]
  openError?: unknown
  /**
   * The rows each tasks query returns, in the order the queries are built:
   * the scope's first (it starts alongside my_open_slots), then mine.
   */
  taskRows?: unknown[][]
  taskErrors?: unknown[]
  directoryError?: unknown
}

// Every tasks query records its builder calls separately, so a test can tell
// the viewer's own read from the scope's.
function mockPlanner(fixture: Fixture = {}) {
  const taskQueries: Call[][] = []
  const directoryCalls: Call[] = []
  const rpc = vi.fn(async (name: string) => {
    expect(name).toBe("my_open_slots")
    return {
      data: fixture.openSlots ?? [
        { id: "s1", task_id: T1, state: "awaiting_response" },
        { id: "s2", task_id: T1, state: "on_it" },
        { id: "s3", task_id: T2, state: "on_it" },
      ],
      error: fixture.openError ?? null,
    }
  })
  const recorder = (calls: Call[], result: () => unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "order", "eq", "not", "in", "gte", "lt"]) {
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
      const index = taskQueries.length
      const calls: Call[] = []
      taskQueries.push(calls)
      return recorder(calls, () => ({
        data: fixture.taskRows?.[index] ?? [],
        error: fixture.taskErrors?.[index] ?? null,
      }))
    }
    if (table === "member_directory") {
      return recorder(directoryCalls, () => ({
        data: [
          { id: ME, name: "Sam Layout" },
          { id: OTHER, name: "Olive Writer" },
        ],
        error: fixture.directoryError ?? null,
      }))
    }
    throw new Error(`unexpected table: ${table}`)
  })
  createClient.mockResolvedValue({ from, rpc })
  return { taskQueries, directoryCalls, rpc, from }
}

const callsOf = (calls: Call[], ...methods: string[]) =>
  calls.filter((call) => methods.includes(call.method))

describe("getPlanner", () => {
  it("reads only the month's window, from Manila midnight on the 1st to the next 1st", async () => {
    const { taskQueries } = mockPlanner()

    await getPlanner("2026-10", { kind: "desk", id: "layout" })

    expect(taskQueries).toHaveLength(2)
    for (const calls of taskQueries) {
      expect(callsOf(calls, "gte", "lt")).toEqual([
        { method: "gte", args: ["due_at", "2026-09-30T16:00:00.000Z"] },
        { method: "lt", args: ["due_at", "2026-10-31T16:00:00.000Z"] },
      ])
    }
  })

  it("reads my tasks by the distinct ids my_open_slots gives, with the Board's select and ordering", async () => {
    const { taskQueries, rpc } = mockPlanner()

    await getPlanner("2026-10", null)

    expect(rpc).toHaveBeenCalledWith("my_open_slots")
    expect(taskQueries).toHaveLength(1)
    const [mine] = taskQueries
    expect(callsOf(mine, "in")).toEqual([
      { method: "in", args: ["id", [T1, T2]] },
    ])
    expect(callsOf(mine, "select")).toEqual([
      {
        method: "select",
        args: [
          "id, title, due_at, column, sections(name), desks(name), task_assignments(member_id, state)",
        ],
      },
    ])
    expect(callsOf(mine, "order")).toEqual([
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
    expect(callsOf(mine, "eq", "not")).toEqual([])
  })

  it("returns [] with no further query when I hold no open slot and there is no scope", async () => {
    const { taskQueries, directoryCalls } = mockPlanner({ openSlots: [] })

    await expect(getPlanner("2026-10", null)).resolves.toEqual([])
    expect(taskQueries).toEqual([])
    expect(directoryCalls).toEqual([])
  })

  it("reads only the scope when I hold no open slot", async () => {
    const { taskQueries } = mockPlanner({
      openSlots: [],
      taskRows: [[task(T3, "2026-10-20T09:00:00+00:00", { column: "done" })]],
    })

    const cards = await getPlanner("2026-10", { kind: "desk", id: "layout" })

    expect(taskQueries).toHaveLength(1)
    expect(callsOf(taskQueries[0], "in")).toEqual([])
    expect(callsOf(taskQueries[0], "eq")).toEqual([
      { method: "eq", args: ["owning_desk_id", "layout"] },
    ])
    // Done included: the scope isn't filtered by column.
    expect(cards.map((card) => [card.id, card.column])).toEqual([[T3, "done"]])
  })

  it.each([
    [
      { kind: "section", id: "feature" } as const,
      [{ method: "eq", args: ["owning_section_id", "feature"] }],
    ],
    [
      { kind: "desk", id: "layout" } as const,
      [{ method: "eq", args: ["owning_desk_id", "layout"] }],
    ],
    [
      { kind: "articles" } as const,
      [{ method: "not", args: ["owning_section_id", "is", null] }],
    ],
  ])(
    "filters the scope %j with the Board's owner filter",
    async (scope, expected) => {
      const { taskQueries } = mockPlanner()

      await getPlanner("2026-10", scope)

      const [scoped, mine] = taskQueries
      expect(callsOf(mine, "eq", "not")).toEqual([])
      expect(callsOf(scoped, "eq", "not")).toEqual(expected)
      expect(callsOf(scoped, "in")).toEqual([])
    }
  )

  it("shows a task that is both mine and in scope once, ordered by due date then id", async () => {
    const shared = task(T2, "2026-10-10T09:00:00+00:00")
    mockPlanner({
      taskRows: [
        [task(T1, "2026-10-20T09:00:00+00:00"), shared],
        [shared, task(T3, "2026-10-10T09:00:00+00:00")],
      ],
    })

    const cards = await getPlanner("2026-10", { kind: "desk", id: "layout" })

    // T2 and T3 share a due time, so the id breaks the tie.
    expect(cards.map((card) => card.id)).toEqual([T2, T3, T1])
  })

  it("builds task cards with names from the whole member_directory", async () => {
    const { directoryCalls } = mockPlanner({
      taskRows: [
        [
          task(T1, "2026-10-01T00:00:00+00:00", {
            title: "Masthead brief",
            column: "doing",
            sections: { name: "News" },
            desks: null,
            task_assignments: [
              { member_id: ME, state: "on_it" },
              { member_id: OTHER, state: "awaiting_response" },
              { member_id: "gone", state: "needs_reassignment" },
            ],
          }),
        ],
      ],
    })

    const cards = await getPlanner("2026-10", null)

    expect(directoryCalls).toEqual([{ method: "select", args: ["id, name"] }])
    expect(cards).toEqual([
      {
        id: T1,
        title: "Masthead brief",
        ownerName: "News",
        dueAt: "2026-10-01T00:00:00+00:00",
        column: "doing",
        overdue: true,
        hasAwaitingResponse: true,
        hasNeedsReassignment: true,
        assignees: [
          { id: ME, name: "Sam Layout", initials: "SL" },
          { id: OTHER, name: "Olive Writer", initials: "OW" },
          { id: "gone", name: "Former member", initials: "FM" },
        ],
      },
    ])
  })

  it("reads no directory when the month has no tasks", async () => {
    const { taskQueries, directoryCalls } = mockPlanner({ taskRows: [[], []] })

    await expect(getPlanner("2026-10", { kind: "articles" })).resolves.toEqual(
      []
    )
    expect(taskQueries).toHaveLength(2)
    expect(directoryCalls).toEqual([])
  })

  it.each([
    ["my_open_slots", { openError: { message: "x" } }],
    ["my tasks", { taskErrors: [null, { message: "x" }] }],
    ["the scope's tasks", { taskErrors: [{ message: "x" }] }],
    [
      "member_directory",
      {
        taskRows: [[task(T1, "2026-10-01T00:00:00+00:00")]],
        directoryError: { message: "x" },
      },
    ],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockPlanner(fixture)

    await expect(
      getPlanner("2026-10", { kind: "desk", id: "layout" })
    ).rejects.toThrow(`getPlanner: reading ${name} failed`)
  })
})
