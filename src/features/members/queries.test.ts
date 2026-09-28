import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getCurrentMember } from "./queries"

type Row = { id: string; name: string; role: string }

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { state, createClient } = vi.hoisted(() => {
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
  return {
    state,
    createClient: vi.fn(async () => ({
      auth: { getClaims: state.claims },
      from,
    })),
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))

const STAFF = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Staff Layout Artist",
  role: "staff",
}
const ADMIN = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Head Layout Artist",
  role: "editorial_admin",
}

function claimsFor(sub: string | undefined) {
  return { data: { claims: { sub, role: "authenticated" } }, error: null }
}

beforeEach(() => {
  state.rows = [STAFF, ADMIN]
  state.queryError = null
  state.selected = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("getCurrentMember", () => {
  it("returns the members row matching the verified sub", async () => {
    state.claims.mockResolvedValue(claimsFor(ADMIN.id))

    await expect(getCurrentMember()).resolves.toEqual(ADMIN)
    expect(state.selected).toEqual(["id, name, role"])
  })

  it("takes the role from the row, never from the token", async () => {
    state.claims.mockResolvedValue({
      data: {
        claims: {
          sub: STAFF.id,
          role: "authenticated",
          app_metadata: { role: "editorial_admin" },
          user_role: "editorial_admin",
        },
      },
      error: null,
    })

    await expect(getCurrentMember()).resolves.toEqual(STAFF)
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
