import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// getTaskFormOptions imports PRODUCTION_ROLE_LABELS through
// @/features/members, whose index.ts also pulls in actions.ts (env.client).
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { getTaskDetail, getTaskFormOptions } from "./queries"

afterEach(() => {
  vi.clearAllMocks()
})

const SECTIONS = [
  { id: "news", name: "News" },
  { id: "sports", name: "Sports" },
]

const DESKS = [
  { id: "writers", name: "Writers", production_role: "writer" },
  { id: "layout", name: "Layout", production_role: "layout_artist" },
]

const HEAD_LAYOUT = "00000000-0000-4000-8000-000000000001"
const STAFF_WRITER = "00000000-0000-4000-8000-000000000002"
const NO_POSITIONS = "00000000-0000-4000-8000-000000000003"

const MEMBERS = [
  {
    id: HEAD_LAYOUT,
    name: "Head Layout Artist",
    positions: [
      { position: "head_layout_artist", is_primary: true, desk_id: "layout" },
    ],
  },
  {
    id: STAFF_WRITER,
    name: "Staff Writer",
    positions: [
      { position: "staff_writer", is_primary: true, desk_id: "writers" },
    ],
  },
  {
    // Top editors and management hold positions with no desk_id.
    id: NO_POSITIONS,
    name: "Editor-in-Chief",
    positions: [
      { position: "editor_in_chief", is_primary: true, desk_id: null },
    ],
  },
]

// A minimal stand-in for the query builder chain
// (`.from(t).select(s).order(o)` or `.neq(...)`), thenable so `await` works.
function queryResult<T>(data: T, error: unknown = null) {
  const builder = {
    select: () => builder,
    order: () => builder,
    neq: () => builder,
    then: (resolve: (value: { data: T; error: unknown }) => void) =>
      resolve({ data, error }),
  }
  return builder
}

function mockSupabase({
  sections = SECTIONS,
  desks = DESKS,
  members = MEMBERS,
  sectionsError = null as unknown,
  desksError = null as unknown,
  membersError = null as unknown,
} = {}) {
  createClient.mockResolvedValue({
    from: (table: string) => {
      if (table === "sections") return queryResult(sections, sectionsError)
      if (table === "desks") return queryResult(desks, desksError)
      if (table === "member_directory") return queryResult(members, membersError)
      throw new Error(`unexpected table: ${table}`)
    },
  })
}

describe("getTaskFormOptions", () => {
  it("lists every section, then every desk but Writers, as owner options", async () => {
    mockSupabase()

    const { owners } = await getTaskFormOptions()

    expect(owners).toEqual([
      { kind: "section", id: "news", name: "News" },
      { kind: "section", id: "sports", name: "Sports" },
      { kind: "desk", id: "layout", name: "Layout" },
    ])
  })

  it("groups active members by the production role their desk position produces", async () => {
    mockSupabase()

    const { slotMembersByRole } = await getTaskFormOptions()

    expect(slotMembersByRole).toEqual({
      layout_artist: [{ id: HEAD_LAYOUT, name: "Head Layout Artist" }],
      writer: [{ id: STAFF_WRITER, name: "Staff Writer" }],
    })
  })

  it("keeps the Writers desk in the role map, even though it's excluded from owners", async () => {
    mockSupabase()

    const { slotMembersByRole } = await getTaskFormOptions()

    expect(slotMembersByRole.writer).toEqual([
      { id: STAFF_WRITER, name: "Staff Writer" },
    ])
  })

  it("lists every active member in allMembers, including one with no desk position", async () => {
    mockSupabase()

    const { allMembers } = await getTaskFormOptions()

    expect(allMembers).toEqual([
      { id: HEAD_LAYOUT, name: "Head Layout Artist" },
      { id: STAFF_WRITER, name: "Staff Writer" },
      { id: NO_POSITIONS, name: "Editor-in-Chief" },
    ])
  })

  it("resolves display labels for every production role", async () => {
    mockSupabase()

    const { roleLabels } = await getTaskFormOptions()

    expect(roleLabels.layout_artist).toBe("Layout Artist")
    expect(Object.keys(roleLabels)).toHaveLength(6)
  })

  it.each([
    ["sections", { sectionsError: { message: "boom" } }],
    ["desks", { desksError: { message: "boom" } }],
    ["member_directory", { membersError: { message: "boom" } }],
  ])("throws when reading %s fails", async (_table, overrides) => {
    mockSupabase(overrides)

    await expect(getTaskFormOptions()).rejects.toThrow(/getTaskFormOptions/)
  })
})

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const SLOT_A = "00000000-0000-4000-8000-000000000031"
const SLOT_B = "00000000-0000-4000-8000-000000000032"
const SLOT_C = "00000000-0000-4000-8000-000000000033"
const FORMER = "00000000-0000-4000-8000-000000000009"

const TASK_ROW = {
  id: TASK_ID,
  title: "Lay out the spread",
  description: "Two pages.",
  due_at: "2026-10-31T15:30:00+00:00",
  reference_url: "https://example.com/brief",
  column: "to_do",
  sections: null,
  desks: { name: "Layout" },
}

const SLOT_ROWS = [
  { id: SLOT_A, member_id: HEAD_LAYOUT, role: "layout_artist", state: "on_it" },
  { id: SLOT_B, member_id: STAFF_WRITER, role: "writer", state: "needs_reassignment" },
  { id: SLOT_C, member_id: FORMER, role: "cartoonist", state: "awaiting_response" },
]

type Call = { table: string; calls: [string, ...unknown[]][] }

// Records every query-builder call per table, and resolves to the given
// result whether the chain ends in maybeSingle() or is awaited directly.
function detailBuilder(call: Call, result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "order", "in"]) {
    builder[method] = (...args: unknown[]) => {
      call.calls.push([method, ...args])
      return builder
    }
  }
  builder.maybeSingle = () => {
    call.calls.push(["maybeSingle"])
    return Promise.resolve(result)
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder
}

function mockDetail({
  task = TASK_ROW as unknown,
  slots = SLOT_ROWS as unknown,
  capabilities = [
    { task_id: TASK_ID, allowed_moves: ["doing", "for_review"], respondable_slot_ids: [SLOT_C] },
  ] as unknown,
  members = [
    { id: HEAD_LAYOUT, name: "Head Layout Artist" },
    { id: STAFF_WRITER, name: "Staff Writer" },
  ] as unknown,
  reasons = [{ assignment_id: SLOT_B, reason: "Exams all week" }] as unknown,
  errors = {} as Partial<Record<string, unknown>>,
} = {}) {
  const calls: Call[] = []
  const rpc = vi.fn(() =>
    Promise.resolve({ data: capabilities, error: errors.task_capabilities ?? null })
  )
  const results: Record<string, unknown> = {
    tasks: task,
    task_assignments: slots,
    member_directory: members,
    assignment_reasons: reasons,
  }
  createClient.mockResolvedValue({
    rpc,
    from: (table: string) => {
      if (!(table in results)) throw new Error(`unexpected table: ${table}`)
      const call: Call = { table, calls: [] }
      calls.push(call)
      return detailBuilder(call, { data: results[table], error: errors[table] ?? null })
    },
  })
  return { calls, rpc }
}

describe("getTaskDetail", () => {
  it.each(["abc", "", "1", `${TASK_ID}x`, "00000000-0000-0000-0000-00000000002g"])(
    "returns null for the malformed id %j without querying",
    async (id) => {
      await expect(getTaskDetail(id)).resolves.toBeNull()
      expect(createClient).not.toHaveBeenCalled()
    }
  )

  it("returns null when the caller can read no such task", async () => {
    mockDetail({ task: null, slots: [], capabilities: [] })

    await expect(getTaskDetail(TASK_ID)).resolves.toBeNull()
  })

  it("reads the task with its owner's name, the slots in creation order, and task_capabilities for this one id", async () => {
    const { calls, rpc } = mockDetail()

    await getTaskDetail(TASK_ID)

    const tasks = calls.find((c) => c.table === "tasks")!
    expect(tasks.calls).toContainEqual([
      "select",
      "id, title, description, due_at, reference_url, column, sections(name), desks(name)",
    ])
    expect(tasks.calls).toContainEqual(["eq", "id", TASK_ID])
    const slots = calls.find((c) => c.table === "task_assignments")!
    expect(slots.calls).toContainEqual(["eq", "task_id", TASK_ID])
    expect(slots.calls.filter(([method]) => method === "order")).toEqual([
      ["order", "created_at"],
      ["order", "id"],
    ])
    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", { ids: [TASK_ID] })
  })

  it("reads names from member_directory and reasons for exactly the task's slots", async () => {
    const { calls } = mockDetail()

    await getTaskDetail(TASK_ID)

    const directory = calls.find((c) => c.table === "member_directory")!
    expect(directory.calls).toContainEqual(["in", "id", [HEAD_LAYOUT, STAFF_WRITER, FORMER]])
    const reasons = calls.find((c) => c.table === "assignment_reasons")!
    expect(reasons.calls).toContainEqual(["in", "assignment_id", [SLOT_A, SLOT_B, SLOT_C]])
    expect(calls.map((c) => c.table)).not.toContain("members")
  })

  it("returns the task, its slots with names and readable reasons, and the capabilities as given", async () => {
    mockDetail()

    const detail = await getTaskDetail(TASK_ID)

    expect(detail).toEqual({
      id: TASK_ID,
      title: "Lay out the spread",
      description: "Two pages.",
      ownerName: "Layout",
      dueAt: "2026-10-31T15:30:00+00:00",
      referenceUrl: "https://example.com/brief",
      column: "to_do",
      slots: [
        {
          id: SLOT_A,
          role: "layout_artist",
          memberId: HEAD_LAYOUT,
          memberName: "Head Layout Artist",
          state: "on_it",
          reason: null,
        },
        {
          id: SLOT_B,
          role: "writer",
          memberId: STAFF_WRITER,
          memberName: "Staff Writer",
          state: "needs_reassignment",
          reason: "Exams all week",
        },
        {
          id: SLOT_C,
          role: "cartoonist",
          memberId: FORMER,
          memberName: "Former member",
          state: "awaiting_response",
          reason: null,
        },
      ],
      allowedMoves: ["doing", "for_review"],
      respondableSlotIds: [SLOT_C],
      roleLabels: expect.objectContaining({ layout_artist: "Layout Artist" }),
    })
  })

  it("names a section-owned task's section", async () => {
    mockDetail({ task: { ...TASK_ROW, sections: { name: "News" }, desks: null } })

    expect((await getTaskDetail(TASK_ID))?.ownerName).toBe("News")
  })

  it("offers nothing when task_capabilities returns no row for the task", async () => {
    mockDetail({ capabilities: [] })

    const detail = await getTaskDetail(TASK_ID)

    expect(detail?.allowedMoves).toEqual([])
    expect(detail?.respondableSlotIds).toEqual([])
  })

  it.each([
    "tasks",
    "task_assignments",
    "task_capabilities",
    "member_directory",
    "assignment_reasons",
  ])("throws when reading %s fails", async (table) => {
    mockDetail({ errors: { [table]: { message: "boom" } } })

    await expect(getTaskDetail(TASK_ID)).rejects.toThrow(
      new RegExp(`getTaskDetail: reading ${table} failed`)
    )
  })
})
