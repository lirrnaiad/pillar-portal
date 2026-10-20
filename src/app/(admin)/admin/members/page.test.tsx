import { Suspense, type ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getMemberApprovals,
  MemberApprovals,
  MemberApprovalsSkeleton,
  requireAdmin,
} = vi.hoisted(() => ({
  getMemberApprovals: vi.fn(),
  MemberApprovals: vi.fn(() => null),
  MemberApprovalsSkeleton: vi.fn(() => null),
  requireAdmin: vi.fn(),
}))

vi.mock("@/features/members", () => ({
  getMemberApprovals,
  MemberApprovals,
  MemberApprovalsSkeleton,
}))
vi.mock("../../require-admin", () => ({ requireAdmin }))

import AdminMembersPage, { metadata } from "./page"

const APPROVALS = { pending: [], roster: [], positionGroups: [] }

afterEach(() => {
  vi.clearAllMocks()
})

type Element = ReactElement<{
  children: Element | Element[]
  fallback?: Element
}>

describe("AdminMembersPage", () => {
  it("is titled Members", () => {
    expect(metadata).toEqual({ title: "Members · The Pillar Portal" })
  })

  it("checks for an admin, then renders the h1 and the lists inside a Suspense boundary with the skeleton", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    getMemberApprovals.mockResolvedValue(APPROVALS)

    const page = (await AdminMembersPage()) as Element
    const [h1, boundary] = page.props.children as Element[]

    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Members")
    expect(boundary.type).toBe(Suspense)
    expect(boundary.props.fallback?.type).toBe(MemberApprovalsSkeleton)
    // Nothing is read until the boundary's child renders.
    expect(getMemberApprovals).not.toHaveBeenCalled()

    const list = boundary.props.children as Element
    const rendered = (await (list.type as () => Promise<Element>)()) as Element
    expect(getMemberApprovals).toHaveBeenCalledOnce()
    expect(rendered.type).toBe(MemberApprovals)
    expect(rendered.props).toEqual({ approvals: APPROVALS })
  })

  it("runs the admin check first and renders nothing when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminMembersPage()).rejects.toBe(redirectError)
    expect(getMemberApprovals).not.toHaveBeenCalled()
  })
})
