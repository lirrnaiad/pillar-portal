import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { requireActiveMember, MemberShell, RedirectError } = vi.hoisted(() => {
  // Like Next's redirect(), which requireActiveMember calls, the mock throws.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    requireActiveMember: vi.fn(),
    MemberShell: vi.fn(() => null),
    RedirectError,
  }
})

// requireActiveMember's own tests (queries.test.ts) cover who it redirects.
vi.mock("@/features/members", () => ({ requireActiveMember }))
vi.mock("./member-shell", () => ({ MemberShell }))

import type { CurrentMember } from "@/features/members"

import MemberLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Head Layout Artist",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

afterEach(() => {
  vi.clearAllMocks()
})

describe("MemberLayout", () => {
  it("runs the shared state check, and renders nothing when it redirects", async () => {
    requireActiveMember.mockRejectedValue(new RedirectError("/login"))

    await expect(MemberLayout({ children: null })).rejects.toEqual(
      new RedirectError("/login")
    )
    expect(requireActiveMember).toHaveBeenCalledOnce()
    expect(MemberShell).not.toHaveBeenCalled()
  })

  it.each(["staff", "editorial_admin"] as const)(
    "renders the member shell for an active %s member, with the notice-toast reader mounted before the page",
    async (role) => {
      const member = { ...MEMBER, role }
      requireActiveMember.mockResolvedValue(member)

      const element = await MemberLayout({ children: "page" })

      expect(element.type).toBe(MemberShell)
      expect(element.props.member).toEqual(member)
      const children = element.props.children as unknown[]
      expect(children[children.length - 1]).toBe("page")
      expect(children.length).toBeGreaterThan(1)
    }
  )
})
