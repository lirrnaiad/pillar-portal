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

import {
  getTaskDetail,
  getTaskForCalendar,
  getTaskFormOptions,
  getWhatsMine,
} from "./queries"

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
      if (table === "member_directory")
        return queryResult(members, membersError)
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
  {
    id: SLOT_B,
    member_id: STAFF_WRITER,
    role: "writer",
    state: "needs_reassignment",
  },
  {
    id: SLOT_C,
    member_id: FORMER,
    role: "cartoonist",
    state: "awaiting_response",
  },
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
    {
      task_id: TASK_ID,
      allowed_moves: ["doing", "for_review"],
      respondable_slot_ids: [SLOT_C],
      hand_back_slot_ids: [SLOT_B],
    },
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
    Promise.resolve({
      data: capabilities,
      error: errors.task_capabilities ?? null,
    })
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
      return detailBuilder(call, {
        data: results[table],
        error: errors[table] ?? null,
      })
    },
  })
  return { calls, rpc }
}

describe("getTaskDetail", () => {
  it.each([
    "abc",
    "",
    "1",
    `${TASK_ID}x`,
    "00000000-0000-0000-0000-00000000002g",
  ])("returns null for the malformed id %j without querying", async (id) => {
    await expect(getTaskDetail(id)).resolves.toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

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
    expect(rpc).toHaveBeenCalledExactlyOnceWith("task_capabilities", {
      ids: [TASK_ID],
    })
  })

  it("reads names from member_directory and reasons for exactly the task's slots", async () => {
    const { calls } = mockDetail()

    await getTaskDetail(TASK_ID)

    const directory = calls.find((c) => c.table === "member_directory")!
    expect(directory.calls).toContainEqual([
      "in",
      "id",
      [HEAD_LAYOUT, STAFF_WRITER, FORMER],
    ])
    const reasons = calls.find((c) => c.table === "assignment_reasons")!
    expect(reasons.calls).toContainEqual([
      "in",
      "assignment_id",
      [SLOT_A, SLOT_B, SLOT_C],
    ])
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
      handBackSlotIds: [SLOT_B],
      roleLabels: expect.objectContaining({ layout_artist: "Layout Artist" }),
    })
  })

  it("names a section-owned task's section", async () => {
    mockDetail({
      task: { ...TASK_ROW, sections: { name: "News" }, desks: null },
    })

    expect((await getTaskDetail(TASK_ID))?.ownerName).toBe("News")
  })

  it("offers nothing when task_capabilities returns no row for the task", async () => {
    mockDetail({ capabilities: [] })

    const detail = await getTaskDetail(TASK_ID)

    expect(detail?.allowedMoves).toEqual([])
    expect(detail?.respondableSlotIds).toEqual([])
    expect(detail?.handBackSlotIds).toEqual([])
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

describe("getWhatsMine", () => {
  const ME = "00000000-0000-4000-8000-0000000000a1"
  const OTHER = "00000000-0000-4000-8000-0000000000a2"
  const T1 = "00000000-0000-4000-8000-0000000000b1"
  const T2 = "00000000-0000-4000-8000-0000000000b2"
  const T3 = "00000000-0000-4000-8000-0000000000b3"
  const S1 = "00000000-0000-4000-8000-0000000000c1"
  const S2 = "00000000-0000-4000-8000-0000000000c2"
  const S3 = "00000000-0000-4000-8000-0000000000c3"
  const S4 = "00000000-0000-4000-8000-0000000000c4"
  const S5 = "00000000-0000-4000-8000-0000000000c5"

  const openSlot = (
    id: string,
    task_id: string,
    role: string,
    state: string,
    created_at: string
  ) => ({ id, task_id, member_id: ME, role, state, created_at })

  // T1 is due last, T2 first, T3 in the middle.
  const TASKS = [
    {
      id: T1,
      title: "Late task",
      due_at: "2026-12-01T00:00:00+00:00",
      column: "to_do",
      sections: null,
      desks: { name: "Layout" },
    },
    {
      id: T2,
      title: "Early task",
      due_at: "2026-10-01T00:00:00+00:00",
      column: "doing",
      sections: { name: "News" },
      desks: null,
    },
    {
      id: T3,
      title: "Middle task",
      due_at: "2026-11-01T00:00:00+00:00",
      column: "for_review",
      sections: null,
      desks: { name: "Layout" },
    },
  ]

  // T1: two awaiting slots of mine (S1 layout, S2 cartoonist) plus another
  // member's needs_reassignment slot. T2: on it (S3). T3: awaiting (S4) and
  // on it (S5) of mine, which counts once, under Waiting.
  const OPEN = [
    openSlot(S2, T1, "cartoonist", "awaiting_response", "2026-09-01T00:00:02Z"),
    openSlot(
      S1,
      T1,
      "layout_artist",
      "awaiting_response",
      "2026-09-01T00:00:01Z"
    ),
    openSlot(S3, T2, "layout_artist", "on_it", "2026-09-01T00:00:03Z"),
    openSlot(S4, T3, "writer", "awaiting_response", "2026-09-01T00:00:04Z"),
    openSlot(S5, T3, "cartoonist", "on_it", "2026-09-01T00:00:05Z"),
  ]
  const ALL_SLOTS = [
    ...OPEN.filter((slot) => slot.task_id === T1).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    ),
    {
      id: "00000000-0000-4000-8000-0000000000c6",
      task_id: T1,
      member_id: OTHER,
      role: "writer",
      state: "needs_reassignment",
      created_at: "2026-09-01T00:00:06Z",
    },
    ...OPEN.filter((slot) => slot.task_id !== T1),
  ]

  const DIRECTORY = [
    { id: ME, name: "Sam Layout" },
    { id: OTHER, name: "Olive Writer" },
  ]

  type Fixture = {
    open?: unknown
    openError?: unknown
    tasks?: unknown
    tasksError?: unknown
    slots?: unknown
    slotsError?: unknown
    capabilities?: unknown
    capabilitiesError?: unknown
    directory?: unknown
    directoryError?: unknown
  }

  function mockWhatsMine(fixture: Fixture = {}) {
    const calls: Call[] = []
    const rpc = vi.fn((name: string) => {
      if (name === "my_open_slots") {
        return Promise.resolve({
          data: fixture.open ?? OPEN,
          error: fixture.openError ?? null,
        })
      }
      if (name === "task_capabilities") {
        return Promise.resolve({
          data: fixture.capabilities ?? [
            { task_id: T1, allowed_moves: [], respondable_slot_ids: [S1], hand_back_slot_ids: [] },
            { task_id: T2, allowed_moves: ["to_do"], respondable_slot_ids: [], hand_back_slot_ids: [] },
            { task_id: T3, allowed_moves: [], respondable_slot_ids: [S4], hand_back_slot_ids: [] },
          ],
          error: fixture.capabilitiesError ?? null,
        })
      }
      throw new Error(`unexpected rpc: ${name}`)
    })
    const from = vi.fn((table: string) => {
      const table_results: Record<string, [unknown, unknown]> = {
        tasks: [fixture.tasks ?? TASKS, fixture.tasksError ?? null],
        task_assignments: [
          fixture.slots ?? ALL_SLOTS,
          fixture.slotsError ?? null,
        ],
        member_directory: [
          fixture.directory ?? DIRECTORY,
          fixture.directoryError ?? null,
        ],
      }
      const result = table_results[table]
      if (!result) throw new Error(`unexpected table: ${table}`)
      const call: Call = { table, calls: [] }
      calls.push(call)
      return detailBuilder(call, { data: result[0], error: result[1] })
    })
    createClient.mockResolvedValue({ rpc, from })
    return { rpc, from, calls }
  }

  it("returns empty lists without further queries when nothing is open", async () => {
    const { rpc, from } = mockWhatsMine({ open: [] })

    await expect(getWhatsMine()).resolves.toEqual({ waiting: [], tasks: [] })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })

  it("reads only the open slots' tasks, every slot on them in creation order, their capabilities and their members' names", async () => {
    const { rpc, calls } = mockWhatsMine()

    await getWhatsMine()

    const tasks = calls.find((c) => c.table === "tasks")!
    expect(tasks.calls).toContainEqual(["in", "id", [T1, T2, T3]])
    const slots = calls.find((c) => c.table === "task_assignments")!
    expect(slots.calls).toContainEqual(["in", "task_id", [T1, T2, T3]])
    expect(slots.calls.filter(([method]) => method === "order")).toEqual([
      ["order", "created_at"],
      ["order", "id"],
    ])
    expect(rpc).toHaveBeenCalledWith("task_capabilities", {
      ids: [T1, T2, T3],
    })
    const directory = calls.find((c) => c.table === "member_directory")!
    expect(directory.calls).toContainEqual(["in", "id", [ME, OTHER]])
    expect(calls.map((c) => c.table)).not.toContain("members")
  })

  it("lists each open awaiting slot once, soonest due first, slots of one task in creation order", async () => {
    mockWhatsMine()

    const { waiting } = await getWhatsMine()

    expect(waiting.map((item) => [item.slotId, item.task.id])).toEqual([
      [S4, T3],
      [S1, T1],
      [S2, T1],
    ])
    expect(waiting.map((item) => item.roleLabel)).toEqual([
      "Writer",
      "Layout Artist",
      "Cartoonist",
    ])
  })

  it("keeps a task with an awaiting slot of the viewer's out of My tasks, even with an on-it slot too", async () => {
    mockWhatsMine()

    const { tasks } = await getWhatsMine()

    expect(tasks.map((task) => task.id)).toEqual([T2])
  })

  it("keeps one task's Waiting items in the database's slot order when created_at ties to the millisecond", async () => {
    // S2 was created 100µs before S1: the same millisecond, and the higher id.
    const s2 = openSlot(
      S2,
      T1,
      "cartoonist",
      "awaiting_response",
      "2026-09-01T00:00:01.0001+00:00"
    )
    const s1 = openSlot(
      S1,
      T1,
      "layout_artist",
      "awaiting_response",
      "2026-09-01T00:00:01.0002+00:00"
    )
    mockWhatsMine({
      open: [s1, s2],
      tasks: [TASKS[0]],
      slots: [s2, s1],
      capabilities: [],
    })

    const { waiting } = await getWhatsMine()

    expect(waiting.map((item) => item.slotId)).toEqual([S2, S1])
  })

  it("orders My tasks by due date, then id", async () => {
    mockWhatsMine({
      open: [
        openSlot(S1, T1, "layout_artist", "on_it", "2026-09-01T00:00:01Z"),
        openSlot(S3, T2, "layout_artist", "on_it", "2026-09-01T00:00:03Z"),
        openSlot(S5, T3, "layout_artist", "on_it", "2026-09-01T00:00:05Z"),
      ],
      tasks: [
        { ...TASKS[0], due_at: "2026-11-01T00:00:00+00:00" },
        TASKS[1],
        TASKS[2],
      ],
    })

    const { tasks } = await getWhatsMine()

    // T2 is due first; T1 and T3 tie, so the lower id (T1) wins.
    expect(tasks.map((task) => task.id)).toEqual([T2, T1, T3])
  })

  it("computes the owner name, the two any-slot flags and the assignees on the server", async () => {
    mockWhatsMine()

    const { waiting, tasks } = await getWhatsMine()
    const t1 = waiting.find((item) => item.task.id === T1)!.task

    expect(t1.ownerName).toBe("Layout")
    expect(t1.hasAwaitingResponse).toBe(true)
    expect(t1.hasNeedsReassignment).toBe(true)
    expect(t1.assignees).toEqual([
      { id: ME, name: "Sam Layout", initials: "SL" },
      { id: OTHER, name: "Olive Writer", initials: "OW" },
    ])
    const t3 = waiting.find((item) => item.task.id === T3)!.task
    expect(t3.hasNeedsReassignment).toBe(false)
    // T2's only slot is on it.
    const t2 = tasks.find((task) => task.id === T2)!
    expect(t2.hasAwaitingResponse).toBe(false)
  })

  it("names a section owner, and falls back to Former member for a name the directory lacks", async () => {
    mockWhatsMine({ directory: [{ id: OTHER, name: "Olive Writer" }] })

    const { tasks } = await getWhatsMine()

    expect(tasks[0].ownerName).toBe("News")
    expect(tasks[0].assignees).toEqual([
      { id: ME, name: "Former member", initials: "FM" },
    ])
  })

  it("marks a task overdue only when its due date has passed and it isn't Done", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"))
    try {
      mockWhatsMine()

      const { waiting, tasks } = await getWhatsMine()

      // T2 (Oct 1, Doing) is overdue; T3 (Nov 1) and T1 (Dec 1) are not.
      expect(tasks.find((task) => task.id === T2)?.overdue).toBe(true)
      expect(waiting.find((item) => item.task.id === T3)?.task.overdue).toBe(
        false
      )
      expect(waiting.find((item) => item.task.id === T1)?.task.overdue).toBe(
        false
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("takes respondable only from task_capabilities", async () => {
    mockWhatsMine()

    const { waiting } = await getWhatsMine()

    expect(waiting.map((item) => [item.slotId, item.respondable])).toEqual([
      [S4, true],
      [S1, true],
      [S2, false],
    ])
  })

  it.each([
    ["my_open_slots", { openError: { message: "boom" } }],
    ["tasks", { tasksError: { message: "boom" } }],
    ["task_assignments", { slotsError: { message: "boom" } }],
    ["task_capabilities", { capabilitiesError: { message: "boom" } }],
    ["member_directory", { directoryError: { message: "boom" } }],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockWhatsMine(fixture)

    await expect(getWhatsMine()).rejects.toThrow(
      `getWhatsMine: reading ${name} failed`
    )
  })
})

describe("getTaskForCalendar", () => {
  const client = (result: { data: unknown; error: unknown }) => {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }))
    createClient.mockResolvedValue({ from })
    return from
  }
  const ID = "00000000-0000-4000-8000-000000000021"

  it("maps the row", async () => {
    client({
      data: {
        id: ID,
        title: "T",
        description: null,
        due_at: "2026-10-10T09:00:00+00:00",
        reference_url: "https://x.test",
      },
      error: null,
    })
    expect(await getTaskForCalendar(ID)).toEqual({
      id: ID,
      title: "T",
      description: null,
      dueAt: "2026-10-10T09:00:00+00:00",
      referenceUrl: "https://x.test",
    })
  })

  it("is null for a non-uuid without querying, a missing task and an error", async () => {
    const from = client({ data: null, error: null })
    expect(await getTaskForCalendar("nope")).toBeNull()
    expect(from).not.toHaveBeenCalled()
    expect(await getTaskForCalendar(ID)).toBeNull()
    client({ data: null, error: { message: "x" } })
    expect(await getTaskForCalendar(ID)).toBeNull()
  })
})
