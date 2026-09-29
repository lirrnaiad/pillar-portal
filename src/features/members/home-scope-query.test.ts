import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getMyHomeScope } from "./queries"

type PositionRow = {
  is_primary: boolean
  positions: { desk_id: string | null; heads_section_id: string | null } | null
}

const { state, createClient } = vi.hoisted(() => {
  const state = {
    claims: vi.fn(),
    rows: [] as PositionRow[],
    queryError: null as { code: string; message: string } | null,
    queried: [] as { table: string; columns: string; eq: [string, string] }[],
  }
  const from = (table: string) => ({
    select: (columns: string) => ({
      eq: async (column: string, value: string) => {
        state.queried.push({ table, columns, eq: [column, value] })
        return state.queryError
          ? { data: null, error: state.queryError }
          : { data: state.rows, error: null }
      },
    }),
  })
  return {
    state,
    createClient: vi.fn(async () => ({
      auth: { getClaims: state.claims },
      from,
    })),
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))

const MEMBER_ID = "00000000-0000-4000-8000-000000000002"

beforeEach(() => {
  state.rows = []
  state.queryError = null
  state.queried = []
  state.claims.mockResolvedValue({
    data: { claims: { sub: MEMBER_ID } },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("getMyHomeScope", () => {
  it("reads the caller's own member_positions and derives the scope", async () => {
    state.rows = [
      {
        is_primary: false,
        positions: { desk_id: "photo", heads_section_id: null },
      },
      {
        is_primary: true,
        positions: { desk_id: "layout", heads_section_id: null },
      },
    ]

    await expect(getMyHomeScope()).resolves.toEqual({
      kind: "desk",
      id: "layout",
    })
    expect(state.queried).toEqual([
      {
        table: "member_positions",
        columns: "is_primary, positions(desk_id, heads_section_id)",
        eq: ["member_id", MEMBER_ID],
      },
    ])
  })

  it("returns All for a member with no positions", async () => {
    await expect(getMyHomeScope()).resolves.toEqual({ kind: "all" })
  })

  it.each([
    ["nobody is signed in", { data: null, error: null }],
    ["the claims can't be verified", { data: null, error: { name: "x" } }],
    ["the claims have no sub", { data: { claims: {} }, error: null }],
  ])("returns All, with no query, when %s", async (_label, claims) => {
    state.claims.mockResolvedValue(claims)

    await expect(getMyHomeScope()).resolves.toEqual({ kind: "all" })
    expect(state.queried).toEqual([])
  })

  it("throws when the query fails", async () => {
    state.queryError = { code: "PGRST000", message: "connection refused" }

    await expect(getMyHomeScope()).rejects.toThrow(
      "getMyHomeScope: reading member_positions failed"
    )
  })
})
