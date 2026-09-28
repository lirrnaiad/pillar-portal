import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getCurrentMember, AdminShell, redirect, RedirectError } = vi.hoisted(
  () => {
    // Like Next's redirect(), the mock throws, so nothing after it runs.
    class RedirectError extends Error {
      constructor(readonly url: string) {
        super(`NEXT_REDIRECT ${url}`)
      }
    }
    return {
      getCurrentMember: vi.fn(),
      AdminShell: vi.fn(() => null),
      redirect: vi.fn((url: string) => {
        throw new RedirectError(url)
      }),
      RedirectError,
    }
  }
)

vi.mock("@/features/members", () => ({ getCurrentMember }))
vi.mock("./admin-shell", () => ({ AdminShell }))
vi.mock("next/navigation", () => ({ redirect }))

import type { CurrentMember } from "@/features/members"

import AdminLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Editor-in-Chief",
  role: "editorial_admin",
} satisfies CurrentMember

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminLayout", () => {
  it.each([
    ["signed out (no member)", null],
    ["pending", { ...MEMBER, role: "pending" as const }],
  ])("sends a %s caller to /login", async (_label, member) => {
    getCurrentMember.mockResolvedValue(member)

    await expect(AdminLayout({ children: null })).rejects.toEqual(
      new RedirectError("/login")
    )
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("sends an active staff member to /dashboard with the admin-restricted notice", async () => {
    getCurrentMember.mockResolvedValue({ ...MEMBER, role: "staff" as const })

    await expect(AdminLayout({ children: null })).rejects.toEqual(
      new RedirectError("/dashboard?notice=admin-restricted")
    )
    expect(redirect).toHaveBeenCalledWith("/dashboard?notice=admin-restricted")
  })

  it("renders the admin shell for an active editorial_admin member", async () => {
    getCurrentMember.mockResolvedValue(MEMBER)

    const element = await AdminLayout({ children: "page" })

    expect(redirect).not.toHaveBeenCalled()
    expect(element.type).toBe(AdminShell)
    expect(element.props).toEqual({ member: MEMBER, children: "page" })
  })
})
