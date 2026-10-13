import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { requireActiveMember, redirect, RedirectError } = vi.hoisted(() => {
  // Like Next's redirect(), the mock throws, so nothing after it runs.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    requireActiveMember: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
  }
})

vi.mock("@/features/members", () => ({ requireActiveMember }))
vi.mock("next/navigation", () => ({ redirect }))

import type { CurrentMember } from "@/features/members"

import { requireAdmin } from "./require-admin"

const ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Editor-in-Chief",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

afterEach(() => {
  vi.clearAllMocks()
})

describe("requireAdmin", () => {
  it("passes on requireActiveMember's redirect to /login (signed out, pending, declined, deactivated)", async () => {
    requireActiveMember.mockRejectedValue(new RedirectError("/login"))

    await expect(requireAdmin()).rejects.toEqual(new RedirectError("/login"))
    expect(redirect).not.toHaveBeenCalled()
  })

  it("sends an active staff member to /dashboard with the admin-restricted notice", async () => {
    requireActiveMember.mockResolvedValue({ ...ADMIN, role: "staff" })

    await expect(requireAdmin()).rejects.toEqual(
      new RedirectError("/dashboard?notice=admin-restricted")
    )
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/dashboard?notice=admin-restricted"
    )
  })

  it("returns an active editorial_admin", async () => {
    requireActiveMember.mockResolvedValue(ADMIN)

    await expect(requireAdmin()).resolves.toEqual(ADMIN)
    expect(redirect).not.toHaveBeenCalled()
  })
})
