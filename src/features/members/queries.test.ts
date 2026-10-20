import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  countPendingApprovalsForViewer,
  getCurrentMember,
  getMemberApprovals,
  requireActiveMember,
} from "./queries"

type Row = {
  id: string
  name: string
  role: string
  declined_at: string | null
  deactivated_at: string | null
}

// One query as the stub saw it: the table, the select (and its options), and
// every filter and order call in order, e.g. ["eq", "role", "pending"].
type Query = {
  table: string
  columns: string
  options?: { count?: string; head?: boolean }
  calls: unknown[][]
}

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { state, createClient, redirect, RedirectError } = vi.hoisted(() => {
  const state = {
    claims: vi.fn(),
    rows: [] as Row[],
    queryError: null as { code: string; message: string } | null,
    selected: [] as string[],
    queries: [] as Query[],
    // What an awaited query (anything but getCurrentMember's maybeSingle)
    // resolves to.
    result: vi.fn<
      (query: Query) => {
        data?: unknown
        count?: number | null
        error: unknown
      }
    >(() => ({ data: [], error: null })),
  }
  // A stub of the query builder that records each call. getCurrentMember's
  // `.eq("id", value).maybeSingle()` filters `rows`, so a query for the wrong
  // id finds the wrong row, or none; any other query is awaited and answered
  // by `result`.
  const from = (table: string) => {
    const query: Query = { table, columns: "", calls: [] }
    const builder = {
      select(columns: string, options?: Query["options"]) {
        query.columns = columns
        if (options) query.options = options
        state.selected.push(columns)
        state.queries.push(query)
        return builder
      },
      eq: (...args: unknown[]) => (query.calls.push(["eq", ...args]), builder),
      neq: (...args: unknown[]) => (
        query.calls.push(["neq", ...args]),
        builder
      ),
      is: (...args: unknown[]) => (query.calls.push(["is", ...args]), builder),
      order: (...args: unknown[]) => (
        query.calls.push(["order", ...args]),
        builder
      ),
      maybeSingle: async () => {
        expect(table).toBe("members")
        if (state.queryError) return { data: null, error: state.queryError }
        const [, column, value] = query.calls[0] as [string, keyof Row, string]
        return {
          data: state.rows.find((row) => row[column] === value) ?? null,
          error: null,
        }
      },
      then(
        onFulfilled: (value: unknown) => unknown,
        onRejected: (reason: unknown) => unknown
      ) {
        return Promise.resolve()
          .then(() => state.result(query))
          .then(onFulfilled, onRejected)
      },
    }
    return builder
  }
  // Like Next's redirect(), the mock throws, so nothing after it runs.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    state,
    createClient: vi.fn(async () => ({
      auth: { getClaims: state.claims },
      from,
    })),
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/navigation", () => ({ redirect }))

const AT = "2026-10-12T09:00:00+00:00"

const STAFF = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Staff Layout Artist",
  role: "staff",
  declined_at: null,
  deactivated_at: null,
}
const ADMIN = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Head Layout Artist",
  role: "editorial_admin",
  declined_at: null,
  deactivated_at: null,
}
const PENDING = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "New Member",
  role: "pending",
  declined_at: null,
  deactivated_at: null,
}
const DECLINED = {
  id: "00000000-0000-4000-8000-000000000005",
  name: "Declined Member",
  role: "pending",
  declined_at: AT,
  deactivated_at: null,
}
const DEACTIVATED = {
  id: "00000000-0000-4000-8000-000000000006",
  name: "Former Head",
  role: "editorial_admin",
  declined_at: null,
  deactivated_at: AT,
}

function claimsFor(sub: string | undefined) {
  return { data: { claims: { sub, role: "authenticated" } }, error: null }
}

beforeEach(() => {
  state.rows = [STAFF, ADMIN, PENDING, DECLINED, DEACTIVATED]
  state.queryError = null
  state.selected = []
  state.queries = []
  state.result.mockImplementation(() => ({ data: [], error: null }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("getCurrentMember", () => {
  it("returns the members row matching the verified sub, with its state", async () => {
    state.claims.mockResolvedValue(claimsFor(ADMIN.id))

    await expect(getCurrentMember()).resolves.toEqual({
      id: ADMIN.id,
      name: ADMIN.name,
      role: "editorial_admin",
      state: "active",
    })
    expect(state.selected).toEqual([
      "id, name, role, declined_at, deactivated_at",
    ])
  })

  it.each([
    ["active", STAFF],
    ["pending", PENDING],
    ["declined", DECLINED],
    ["deactivated", DEACTIVATED],
  ])("reads the state %s from the row", async (memberState, row) => {
    state.claims.mockResolvedValue(claimsFor(row.id))

    await expect(getCurrentMember()).resolves.toMatchObject({
      id: row.id,
      role: row.role,
      state: memberState,
    })
  })

  it("takes the role and state from the row, never from the token", async () => {
    state.claims.mockResolvedValue({
      data: {
        claims: {
          sub: DEACTIVATED.id,
          role: "authenticated",
          app_metadata: { role: "editorial_admin", state: "active" },
          user_role: "editorial_admin",
        },
      },
      error: null,
    })

    await expect(getCurrentMember()).resolves.toMatchObject({
      id: DEACTIVATED.id,
      state: "deactivated",
    })
  })

  it.each([
    ["nobody is signed in", { data: null, error: null }],
    [
      "the claims can't be verified",
      { data: null, error: { name: "AuthInvalidJwtError" } },
    ],
    ["the claims have no sub", claimsFor(undefined)],
    [
      "the sub has no members row",
      claimsFor("00000000-0000-4000-8000-00000000ffff"),
    ],
  ])("returns null when %s", async (_label, claims) => {
    state.claims.mockResolvedValue(claims)

    await expect(getCurrentMember()).resolves.toBeNull()
  })

  it("throws when the members query fails, rather than looking signed out", async () => {
    state.claims.mockResolvedValue(claimsFor(STAFF.id))
    state.queryError = { code: "PGRST000", message: "connection refused" }

    await expect(getCurrentMember()).rejects.toThrow(
      "getCurrentMember: reading the members row failed"
    )
  })
})

describe("requireActiveMember", () => {
  it.each([
    ["staff", STAFF],
    ["editorial_admin", ADMIN],
  ])("returns the active %s member", async (_label, row) => {
    state.claims.mockResolvedValue(claimsFor(row.id))

    await expect(requireActiveMember()).resolves.toEqual({
      id: row.id,
      name: row.name,
      role: row.role,
      state: "active",
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["signed out", null],
    ["with no members row", "00000000-0000-4000-8000-00000000ffff"],
    ["pending", PENDING.id],
    ["declined", DECLINED.id],
    ["deactivated", DEACTIVATED.id],
  ])("sends a caller who is %s to /login", async (_label, sub) => {
    state.claims.mockResolvedValue(
      sub === null ? { data: null, error: null } : claimsFor(sub)
    )

    await expect(requireActiveMember()).rejects.toEqual(
      new RedirectError("/login")
    )
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
  })

  it("lets a failed members query throw, rather than redirecting", async () => {
    state.claims.mockResolvedValue(claimsFor(STAFF.id))
    state.queryError = { code: "PGRST000", message: "connection refused" }

    await expect(requireActiveMember()).rejects.toThrow(
      "getCurrentMember: reading the members row failed"
    )
    expect(redirect).not.toHaveBeenCalled()
  })
})

// The positions getMemberApprovals reads, a few of the real 22 with their
// real flags and sort order.
const POSITIONS = [
  {
    id: "staff_writer",
    title: "Staff Writer",
    is_board: false,
    is_top_editor: false,
    heads_desk_id: null,
    heads_section_id: null,
    sort_order: 1,
  },
  {
    id: "staff_cartoonist",
    title: "Staff Cartoonist",
    is_board: false,
    is_top_editor: false,
    heads_desk_id: null,
    heads_section_id: null,
    sort_order: 3,
  },
  {
    id: "head_cartoonist",
    title: "Head Cartoonist",
    is_board: true,
    is_top_editor: false,
    heads_desk_id: "cartoons",
    heads_section_id: null,
    sort_order: 8,
  },
  {
    id: "news_editor",
    title: "News Editor",
    is_board: true,
    is_top_editor: false,
    heads_desk_id: null,
    heads_section_id: "news",
    sort_order: 12,
  },
  {
    id: "editor_in_chief",
    title: "Editor-in-Chief",
    is_board: true,
    is_top_editor: true,
    heads_desk_id: null,
    heads_section_id: null,
    sort_order: 17,
  },
  {
    id: "online_manager",
    title: "Online Manager",
    is_board: true,
    is_top_editor: false,
    heads_desk_id: null,
    heads_section_id: null,
    sort_order: 22,
  },
]

const PENDING_ROWS = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    name: "New Person",
    email: "new.person@gmail.com",
    created_at: "2026-10-19T01:05:00+00:00",
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    name: "Maria Jose  dela Cruz",
    email: "mj@yahoo.com",
    created_at: "2026-10-20T13:30:00+00:00",
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    name: "Someone Else",
    email: "Staff.Writer+second@gmail.com",
    created_at: "2026-10-20T14:00:00+00:00",
  },
]

const ACTIVE_ROWS = [
  {
    id: "00000000-0000-4000-8000-000000000021",
    name: "María José Dela Cruz",
    email: "mj.delacruz@gmail.com",
    member_positions: [
      { position: "online_manager", is_primary: false },
      { position: "news_editor", is_primary: true },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000022",
    name: "Head Cartoonist",
    email: "staffwriter@example.com",
    member_positions: [
      { position: "staff_cartoonist", is_primary: false },
      { position: "staff_writer", is_primary: false },
      { position: "head_cartoonist", is_primary: true },
    ],
  },
]

// Answers each of getMemberApprovals' three reads by its select.
function answerApprovals(
  overrides: Partial<Record<"pending" | "active" | "positions", unknown>> = {}
) {
  state.result.mockImplementation((query: Query) => {
    if (query.table === "positions") {
      return overrides.positions !== undefined
        ? { data: null, error: overrides.positions }
        : { data: POSITIONS, error: null }
    }
    if (query.columns.includes("created_at")) {
      return overrides.pending !== undefined
        ? { data: null, error: overrides.pending }
        : { data: PENDING_ROWS, error: null }
    }
    return overrides.active !== undefined
      ? { data: null, error: overrides.active }
      : { data: ACTIVE_ROWS, error: null }
  })
}

const NOT_DECLINED_OR_DEACTIVATED = [
  ["is", "declined_at", null],
  ["is", "deactivated_at", null],
]

describe("getMemberApprovals", () => {
  it("reads pending members oldest first, active members by name and the positions, as the caller", async () => {
    answerApprovals()

    await getMemberApprovals()

    expect(state.queries).toEqual([
      {
        table: "members",
        columns: "id, name, email, created_at",
        calls: [
          ["eq", "role", "pending"],
          ...NOT_DECLINED_OR_DEACTIVATED,
          ["order", "created_at", { ascending: true }],
          ["order", "id", { ascending: true }],
        ],
      },
      {
        table: "members",
        columns: "id, name, email, member_positions(position, is_primary)",
        calls: [
          ["neq", "role", "pending"],
          ...NOT_DECLINED_OR_DEACTIVATED,
          ["order", "name", { ascending: true }],
          ["order", "id", { ascending: true }],
        ],
      },
      {
        table: "positions",
        columns:
          "id, title, is_board, is_top_editor, heads_desk_id, heads_section_id, sort_order",
        calls: [["order", "sort_order", { ascending: true }]],
      },
    ])
  })

  it("maps the pending members with their PHT sign-in time and any look-alike, in the order read", async () => {
    answerApprovals()

    const { pending } = await getMemberApprovals()

    expect(pending).toEqual([
      {
        id: PENDING_ROWS[0].id,
        name: "New Person",
        email: "new.person@gmail.com",
        signedInAt: "2026-10-19T01:05:00+00:00",
        signedInLabel: "Mon, Oct 19, 2026 at 9:05 AM PHT",
        lookAlikeName: null,
      },
      {
        id: PENDING_ROWS[1].id,
        name: "Maria Jose  dela Cruz",
        email: "mj@yahoo.com",
        signedInAt: "2026-10-20T13:30:00+00:00",
        signedInLabel: "Tue, Oct 20, 2026 at 9:30 PM PHT",
        // The name matches once accents, case and spacing are ignored.
        lookAlikeName: "María José Dela Cruz",
      },
      {
        id: PENDING_ROWS[2].id,
        name: "Someone Else",
        email: "Staff.Writer+second@gmail.com",
        signedInAt: "2026-10-20T14:00:00+00:00",
        signedInLabel: "Tue, Oct 20, 2026 at 10:00 PM PHT",
        // The email local part matches once case, dots and +tag are ignored.
        lookAlikeName: "Head Cartoonist",
      },
    ])
  })

  it("lists the roster in the order read, each member's titles primary first, then by sort_order", async () => {
    answerApprovals()

    const { roster } = await getMemberApprovals()

    expect(roster).toEqual([
      {
        id: ACTIVE_ROWS[0].id,
        name: "María José Dela Cruz",
        email: "mj.delacruz@gmail.com",
        positionTitles: ["News Editor", "Online Manager"],
      },
      {
        id: ACTIVE_ROWS[1].id,
        name: "Head Cartoonist",
        email: "staffwriter@example.com",
        positionTitles: ["Head Cartoonist", "Staff Writer", "Staff Cartoonist"],
      },
    ])
  })

  it("groups the offered positions, without Editor-in-Chief and without empty groups", async () => {
    answerApprovals()

    const { positionGroups } = await getMemberApprovals()

    expect(positionGroups).toEqual([
      {
        id: "staff",
        label: "Staff",
        positions: [
          { id: "staff_writer", title: "Staff Writer" },
          { id: "staff_cartoonist", title: "Staff Cartoonist" },
        ],
      },
      {
        id: "section_editors",
        label: "Section Editors",
        positions: [{ id: "news_editor", title: "News Editor" }],
      },
      {
        id: "heads",
        label: "Heads",
        positions: [{ id: "head_cartoonist", title: "Head Cartoonist" }],
      },
      {
        id: "management",
        label: "Management",
        positions: [{ id: "online_manager", title: "Online Manager" }],
      },
    ])
  })

  it("returns empty lists when nobody is pending or active", async () => {
    await expect(getMemberApprovals()).resolves.toEqual({
      pending: [],
      roster: [],
      positionGroups: [],
    })
  })

  it.each([
    ["pending", "pending members"],
    ["active", "active members"],
    ["positions", "positions"],
  ] as const)("throws when the %s read fails", async (which, label) => {
    const cause = { code: "PGRST000", message: "connection refused" }
    answerApprovals({ [which]: cause })

    await expect(getMemberApprovals()).rejects.toThrow(
      `getMemberApprovals: reading ${label} failed`
    )
  })
})

describe("countPendingApprovalsForViewer", () => {
  const countQueries = () => state.queries.filter((query) => query.options)

  it("counts pending, non-declined, non-deactivated members for an active admin", async () => {
    state.claims.mockResolvedValue(claimsFor(ADMIN.id))
    state.result.mockImplementation(() => ({
      data: null,
      count: 3,
      error: null,
    }))

    await expect(countPendingApprovalsForViewer()).resolves.toBe(3)
    expect(countQueries()).toEqual([
      {
        table: "members",
        columns: "id",
        options: { count: "exact", head: true },
        calls: [["eq", "role", "pending"], ...NOT_DECLINED_OR_DEACTIVATED],
      },
    ])
  })

  it("returns 0 when the count comes back empty", async () => {
    state.claims.mockResolvedValue(claimsFor(ADMIN.id))
    state.result.mockImplementation(() => ({
      data: null,
      count: null,
      error: null,
    }))

    await expect(countPendingApprovalsForViewer()).resolves.toBe(0)
  })

  it.each([
    ["signed out", null],
    ["with no members row", "00000000-0000-4000-8000-00000000ffff"],
    ["active staff", STAFF.id],
    ["pending", PENDING.id],
    ["declined", DECLINED.id],
    ["a deactivated former admin", DEACTIVATED.id],
  ])(
    "returns 0 for a caller who is %s, without counting",
    async (_label, sub) => {
      state.claims.mockResolvedValue(
        sub === null ? { data: null, error: null } : claimsFor(sub)
      )

      await expect(countPendingApprovalsForViewer()).resolves.toBe(0)
      expect(countQueries()).toEqual([])
      expect(state.result).not.toHaveBeenCalled()
    }
  )

  it("throws when the count fails", async () => {
    state.claims.mockResolvedValue(claimsFor(ADMIN.id))
    state.result.mockImplementation(() => ({
      data: null,
      count: null,
      error: { code: "PGRST000", message: "connection refused" },
    }))

    await expect(countPendingApprovalsForViewer()).rejects.toThrow(
      "countPendingApprovalsForViewer: counting pending members failed"
    )
  })
})
