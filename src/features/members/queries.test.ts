import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getCurrentMember, requireActiveMember } from "./queries"

type Row = {
  id: string
  name: string
  role: string
  declined_at: string | null
  deactivated_at: string | null
}

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { state, createClient, redirect, RedirectError } = vi.hoisted(() => {
  const state = {
    claims: vi.fn(),
    rows: [] as Row[],
    queryError: null as { code: string; message: string } | null,
    selected: [] as string[],
  }
  // A stub of the calls getCurrentMember makes. `members` holds several rows
  // and `.eq("id", value)` filters them, so a query for the wrong id finds
  // the wrong row, or none.
  const from = (table: string) => {
    expect(table).toBe("members")
    return {
      select: (columns: string) => {
        state.selected.push(columns)
        return {
          eq: (column: keyof Row, value: string) => ({
            maybeSingle: async () =>
              state.queryError
                ? { data: null, error: state.queryError }
                : {
                    data:
                      state.rows.find((row) => row[column] === value) ?? null,
                    error: null,
                  },
          }),
        }
      },
    }
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
