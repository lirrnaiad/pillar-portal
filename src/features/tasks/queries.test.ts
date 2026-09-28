import { describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// getTaskFormOptions imports PRODUCTION_ROLE_LABELS through
// @/features/members, whose index.ts also pulls in actions.ts (env.client).
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { getTaskFormOptions } from "./queries"

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
