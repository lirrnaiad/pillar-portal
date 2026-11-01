import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { createClient, getTaskFormOptions } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getTaskFormOptions: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// Its desk lists, everyone and the labels have their own tests
// (queries.test.ts); getReassignOptions only adds each member's load.
vi.mock("./queries/task-form", () => ({ getTaskFormOptions }))

import { getReassignOptions } from "./queries/reassign"

const HEAD_LAYOUT = "00000000-0000-4000-8000-000000000001"
const STAFF_WRITER = "00000000-0000-4000-8000-000000000002"
const NO_ROW = "00000000-0000-4000-8000-000000000003"

const ROLE_LABELS = {
  writer: "Writer",
  layout_artist: "Layout Artist",
  cartoonist: "Cartoonist",
  photojournalist: "Photojournalist",
  broadcast_journalist: "Broadcast Journalist",
  videojournalist: "Videojournalist",
}

const FORM_OPTIONS = {
  owners: [{ kind: "desk", id: "layout", name: "Layout" }],
  slotMembersByRole: {
    layout_artist: [{ id: HEAD_LAYOUT, name: "Head Layout Artist" }],
    writer: [{ id: STAFF_WRITER, name: "Staff Writer" }],
  },
  allMembers: [
    { id: HEAD_LAYOUT, name: "Head Layout Artist" },
    { id: STAFF_WRITER, name: "Staff Writer" },
    { id: NO_ROW, name: "Editor-in-Chief" },
  ],
  roleLabels: ROLE_LABELS,
}

function mockCounts(
  data: { member_id: string; open_slots: number }[] | null,
  error: unknown = null
) {
  const rpc = vi.fn(() => Promise.resolve({ data, error }))
  createClient.mockResolvedValue({ rpc })
  getTaskFormOptions.mockResolvedValue(FORM_OPTIONS)
  return rpc
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("getReassignOptions", () => {
  it("reads member_open_slot_counts once, with no arguments", async () => {
    const rpc = mockCounts([])

    await getReassignOptions()

    expect(rpc).toHaveBeenCalledExactlyOnceWith("member_open_slot_counts")
    expect(getTaskFormOptions).toHaveBeenCalledOnce()
  })

  it("gives each desk member and everyone their open slots, 0 for a member with no row, and passes the labels through", async () => {
    mockCounts([
      { member_id: HEAD_LAYOUT, open_slots: 3 },
      { member_id: STAFF_WRITER, open_slots: 0 },
    ])

    const options = await getReassignOptions()

    expect(options).toEqual({
      slotMembersByRole: {
        layout_artist: [
          { id: HEAD_LAYOUT, name: "Head Layout Artist", openSlots: 3 },
        ],
        writer: [{ id: STAFF_WRITER, name: "Staff Writer", openSlots: 0 }],
      },
      allMembers: [
        { id: HEAD_LAYOUT, name: "Head Layout Artist", openSlots: 3 },
        { id: STAFF_WRITER, name: "Staff Writer", openSlots: 0 },
        { id: NO_ROW, name: "Editor-in-Chief", openSlots: 0 },
      ],
      roleLabels: ROLE_LABELS,
    })
    // The task form's owners aren't the picker's business.
    expect(options).not.toHaveProperty("owners")
  })

  it("gives everyone 0 when the counts come back empty", async () => {
    mockCounts(null)

    const options = await getReassignOptions()

    expect(options.allMembers.map((member) => member.openSlots)).toEqual([
      0, 0, 0,
    ])
  })

  it("throws when reading the counts fails", async () => {
    mockCounts(null, { message: "boom" })

    await expect(getReassignOptions()).rejects.toThrow(
      /getReassignOptions: reading member_open_slot_counts failed/
    )
  })
})
