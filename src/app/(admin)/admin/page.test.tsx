import { Suspense, type ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { counts, requireAdmin, AdminHomeCards, AdminHomeSkeleton } = vi.hoisted(
  () => ({
    // Two fixture cards, so the test can see both counts start together.
    counts: [
      {
        id: "pending-approvals",
        label: "Awaiting approval",
        href: "/admin/members",
        count: vi.fn<() => Promise<number>>(),
      },
      {
        id: "fixture",
        label: "Fixture",
        href: "/admin/fixture",
        count: vi.fn<() => Promise<number>>(),
      },
    ],
    requireAdmin: vi.fn(),
    AdminHomeCards: vi.fn(() => null),
    AdminHomeSkeleton: vi.fn(() => null),
  })
)

vi.mock("../require-admin", () => ({ requireAdmin }))
vi.mock("./admin-home-counts", () => ({ ADMIN_HOME_COUNTS: counts }))
vi.mock("./admin-home", () => ({ AdminHomeCards }))
vi.mock("./admin-home-skeleton", () => ({ AdminHomeSkeleton }))

import AdminHomePage, { metadata } from "./page"

afterEach(() => {
  vi.clearAllMocks()
})

type Element = ReactElement<{
  children: Element | Element[]
  fallback?: Element
}>

describe("AdminHomePage", () => {
  it("is titled Admin home", () => {
    expect(metadata).toEqual({ title: "Admin home · The Pillar Portal" })
  })

  it("checks for an admin, then renders the h1 and the cards inside a Suspense boundary with the skeleton", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })

    const page = (await AdminHomePage()) as Element
    const [h1, boundary] = page.props.children as Element[]

    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Admin home")
    expect(boundary.type).toBe(Suspense)
    expect(boundary.props.fallback?.type).toBe(AdminHomeSkeleton)
    // Nothing is read until the boundary's child renders.
    for (const { count } of counts) expect(count).not.toHaveBeenCalled()
  })

  it("reads every count in parallel and hands the cards their numbers", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    let releaseFirst!: (n: number) => void
    counts[0].count.mockReturnValue(
      new Promise((resolve) => (releaseFirst = resolve))
    )
    counts[1].count.mockResolvedValue(0)

    const page = (await AdminHomePage()) as Element
    const [, boundary] = page.props.children as Element[]
    const loader = boundary.props.children as Element
    const rendering = (loader.type as () => Promise<Element>)()

    // The second count starts while the first is still in flight.
    expect(counts[0].count).toHaveBeenCalledOnce()
    expect(counts[1].count).toHaveBeenCalledOnce()
    releaseFirst(2)
    const rendered = (await rendering) as Element

    expect(rendered.type).toBe(AdminHomeCards)
    expect(rendered.props).toEqual({
      cards: [
        {
          id: "pending-approvals",
          label: "Awaiting approval",
          href: "/admin/members",
          count: 2,
        },
        { id: "fixture", label: "Fixture", href: "/admin/fixture", count: 0 },
      ],
    })
  })

  it("lets a throwing count throw (Next's error page)", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    const failure = new Error("count failed")
    counts[0].count.mockRejectedValue(failure)
    counts[1].count.mockResolvedValue(0)

    const page = (await AdminHomePage()) as Element
    const [, boundary] = page.props.children as Element[]
    const loader = boundary.props.children as Element

    await expect((loader.type as () => Promise<Element>)()).rejects.toBe(
      failure
    )
  })

  it("runs the admin check first and reads no count when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /dashboard")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminHomePage()).rejects.toBe(redirectError)
    for (const { count } of counts) expect(count).not.toHaveBeenCalled()
  })
})
