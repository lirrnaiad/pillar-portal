import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getCurrentMember, MemberShell, redirect, RedirectError } = vi.hoisted(
  () => {
    // Like Next's redirect(), the mock throws, so nothing after it runs.
    class RedirectError extends Error {
      constructor(readonly url: string) {
        super(`NEXT_REDIRECT ${url}`)
      }
    }
    return {
      getCurrentMember: vi.fn(),
      MemberShell: vi.fn(() => null),
      redirect: vi.fn((url: string) => {
        throw new RedirectError(url)
      }),
      RedirectError,
    }
  }
)

vi.mock("@/features/members", () => ({ getCurrentMember }))
vi.mock("./member-shell", () => ({ MemberShell }))
vi.mock("next/navigation", () => ({ redirect }))

import type { CurrentMember } from "@/features/members"

import MemberLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Head Layout Artist",
  role: "editorial_admin",
} satisfies CurrentMember

afterEach(() => {
  vi.clearAllMocks()
})

describe("MemberLayout", () => {
  it.each([
    ["signed out (no member)", null],
    ["pending", { ...MEMBER, role: "pending" as const }],
  ])("sends a %s caller to /login", async (_label, member) => {
    getCurrentMember.mockResolvedValue(member)

    await expect(MemberLayout({ children: null })).rejects.toEqual(
      new RedirectError("/login")
    )
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it.each(["staff", "editorial_admin"] as const)(
    "renders the member shell for an active %s member",
    async (role) => {
      const member = { ...MEMBER, role }
      getCurrentMember.mockResolvedValue(member)

      const element = await MemberLayout({ children: "page" })

      expect(redirect).not.toHaveBeenCalled()
      expect(element.type).toBe(MemberShell)
      expect(element.props).toEqual({ member, children: "page" })
    }
  )
})
