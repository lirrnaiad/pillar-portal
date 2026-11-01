import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// queries/shared.ts imports the members barrel, whose index.ts also pulls in
// actions.ts, which reads the server-only env, and env.client; these tests
// use neither.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({}))

import { getTaskEdit } from "./queries/task-edit"

afterEach(() => {
  vi.clearAllMocks()
})

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const SLOT_A = "00000000-0000-4000-8000-000000000031"
const SLOT_B = "00000000-0000-4000-8000-000000000032"
const SLOT_C = "00000000-0000-4000-8000-000000000033"
const STAFF = "00000000-0000-4000-8000-000000000001"
const WRITER = "00000000-0000-4000-8000-000000000002"
// No longer in member_directory.
const FORMER = "00000000-0000-4000-8000-000000000009"

const TASK_ROW = {
  id: TASK_ID,
  title: "Lay out the spread",
  description: "Two pages.",
  // 23:30 PHT on Oct 31, as PostgREST returns it.
  due_at: "2026-10-31T15:30:00+00:00",
  reference_url: "https://example.com/brief",
  column: "doing",
  updated_at: "2026-10-30T02:15:42.123456+00:00",
  sections: null,
  desks: { name: "Layout" },
}

const SLOT_ROWS = [
  { id: SLOT_A, member_id: STAFF, role: "layout_artist" },
  { id: SLOT_B, member_id: WRITER, role: "writer" },
  { id: SLOT_C, member_id: FORMER, role: "cartoonist" },
]

type Call = { table: string; calls: [string, ...unknown[]][] }

// Records every query-builder call per table, and resolves to the given
// result whether the chain ends in maybeSingle() or is awaited directly.
function builder(call: Call, result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ["select", "eq", "order", "in"]) {
    chain[method] = (...args: unknown[]) => {
      call.calls.push([method, ...args])
      return chain
    }
  }
  chain.maybeSingle = () => {
    call.calls.push(["maybeSingle"])
    return Promise.resolve(result)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

function mockEdit({
  task = TASK_ROW as unknown,
  slots = SLOT_ROWS as unknown,
  capabilities = [
    {
      task_id: TASK_ID,
      allowed_moves: [],
      respondable_slot_ids: [],
      hand_back_slot_ids: [],
      can_review: false,
      can_reopen: false,
      can_manage: true,
    },
  ] as unknown,
  members = [
    { id: STAFF, name: "Staff Layout Artist" },
    { id: WRITER, name: "Staff Writer" },
  ] as unknown,
  errors = {} as Partial<Record<string, unknown>>,
} = {}) {
  const calls: Call[] = []
  const rpc = vi.fn(() =>
    Promise.resolve({
      data: capabilities,
      error: errors.task_capabilities ?? null,
    })
  )
  const results: Record<string, unknown> = {
    tasks: task,
    task_assignments: slots,
    member_directory: members,
  }
  createClient.mockResolvedValue({
    rpc,
    from: (table: string) => {
      if (!(table in results)) throw new Error(`unexpected table: ${table}`)
      const call: Call = { table, calls: [] }
      calls.push(call)
      return builder(call, {
        data: results[table],
        error: errors[table] ?? null,
      })
    },
  })
  return { calls, rpc }
}

describe("getTaskEdit", () => {
  it.each(["abc", "", `${TASK_ID}x`])(
    "returns null for the malformed id %j without querying",
    async (id) => {
      await expect(getTaskEdit(id)).resolves.toBeNull()
      expect(createClient).not.toHaveBeenCalled()
    }
  )

  // RLS hides a missing, deleted or unreadable task alike.
  it("returns null when the caller can read no such task", async () => {
    mockEdit({ task: null, slots: [], capabilities: [] })

    await expect(getTaskEdit(TASK_ID)).resolves.toBeNull()
  })

  it("reads the task with its owner's name, its slots in creation order, and task_capabilities for this one id", async () => {
    const { calls, rpc } = mockEdit()

    await getTaskEdit(TASK_ID)

    const tasks = calls.find((c) => c.table === "tasks")!
    expect(tasks.calls).toContainEqual([
      "select",
      "id, title, description, due_at, reference_url, column, updated_at, sections(name), desks(name)",
    ])
    expect(tasks.calls).toContainEqual(["eq", "id", TASK_ID])
    const slots = calls.find((c) => c.table === "task_assignments")!
    expect(slots.calls).toContainEqual(["select", "id, member_id, role"])
    expect(slots.calls).toContainEqual(["eq", "task_id", TASK_ID])
    expect(slots.calls.filter(([method]) => method === "order")).toEqual([
      ["order", "created_at"],
      ["order", "id"],
    ])
    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [TASK_ID],
    })
  })

  it("names each slot's member from member_directory, never members", async () => {
    const { calls } = mockEdit()

    await getTaskEdit(TASK_ID)

    const directory = calls.find((c) => c.table === "member_directory")!
    expect(directory.calls).toContainEqual([
      "in",
      "id",
      [STAFF, WRITER, FORMER],
    ])
    expect(calls.map((c) => c.table)).not.toContain("members")
  })

  it("returns the fields, the due date as the form's PHT value, the slots with names (\"Former member\" for one who left), whether it's Done, and can_manage", async () => {
    mockEdit()

    expect(await getTaskEdit(TASK_ID)).toEqual({
      id: TASK_ID,
      title: "Lay out the spread",
      description: "Two pages.",
      ownerName: "Layout",
      dueAtInput: "2026-10-31T23:30",
      referenceUrl: "https://example.com/brief",
      slots: [
        {
          id: SLOT_A,
          role: "layout_artist",
          memberId: STAFF,
          memberName: "Staff Layout Artist",
        },
        {
          id: SLOT_B,
          role: "writer",
          memberId: WRITER,
          memberName: "Staff Writer",
        },
        {
          id: SLOT_C,
          role: "cartoonist",
          memberId: FORMER,
          memberName: "Former member",
        },
      ],
      done: false,
      canManage: true,
      updatedAt: "2026-10-30T02:15:42.123456+00:00",
    })
  })

  it.each([
    ["to_do", false],
    ["doing", false],
    ["for_review", false],
    ["done", true],
  ])("says a task in %s is Done: %s", async (column, done) => {
    mockEdit({ task: { ...TASK_ROW, column } })

    expect((await getTaskEdit(TASK_ID))?.done).toBe(done)
  })

  it("names a section-owned task's section", async () => {
    mockEdit({ task: { ...TASK_ROW, sections: { name: "News" }, desks: null } })

    expect((await getTaskEdit(TASK_ID))?.ownerName).toBe("News")
  })

  it.each([
    ["can_manage false", [{ task_id: TASK_ID, can_manage: false }]],
    ["no capabilities row", []],
  ])("offers no edit with %s", async (_name, capabilities) => {
    mockEdit({ capabilities })

    expect((await getTaskEdit(TASK_ID))?.canManage).toBe(false)
  })

  it("reads no names for a task with no slots", async () => {
    const { calls } = mockEdit({ slots: [] })

    expect((await getTaskEdit(TASK_ID))?.slots).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain("member_directory")
  })

  it.each([
    "tasks",
    "task_assignments",
    "task_capabilities",
    "member_directory",
  ])("throws when reading %s fails", async (table) => {
    mockEdit({ errors: { [table]: { message: "boom" } } })

    await expect(getTaskEdit(TASK_ID)).rejects.toThrow(
      new RegExp(`getTaskEdit: reading ${table} failed`)
    )
  })
})
