import { Suspense, type ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { counts, list, requireAdmin, AdminHomeCards, AdminHomeSkeleton } =
  vi.hoisted(() => ({
    // Two fixture link cards, so the test can see both counts start
    // together, and a list card between them.
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
    list: {
      id: "handed-back",
      label: "Needs reassignment",
      href: "/admin/tasks",
      linkLabel: "Reassign in Tasks",
      rows: vi.fn<
        () => Promise<{ id: string; text: string; reason: string | null }[]>
      >(),
    },
    requireAdmin: vi.fn(),
    AdminHomeCards: vi.fn(() => null),
    AdminHomeSkeleton: vi.fn(() => null),
  }))

vi.mock("../require-admin", () => ({ requireAdmin }))
vi.mock("./admin-home-counts", () => ({
  ADMIN_HOME_COUNTS: [counts[0], list, counts[1]],
}))
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

const ROWS = [
  {
    id: "s1",
    text: "Draw the strip · Cartoonist · Editor-in-Chief",
    reason: "Busy",
  },
  { id: "s2", text: "Lay out the spread · Layout Artist · Sam", reason: null },
]

async function renderCards() {
  const page = (await AdminHomePage()) as Element
  const [, boundary] = page.props.children as Element[]
  const loader = boundary.props.children as Element
  return (loader.type as () => Promise<Element>)()
}

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
    expect(list.rows).not.toHaveBeenCalled()
  })

  it("reads every count and list in parallel and hands the cards their numbers, a list card its rows counted", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    let releaseFirst!: (n: number) => void
    counts[0].count.mockReturnValue(
      new Promise((resolve) => (releaseFirst = resolve))
    )
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue(ROWS)

    const rendering = renderCards()

    // The others start while the first is still in flight.
    await vi.waitFor(() => expect(counts[0].count).toHaveBeenCalledOnce())
    expect(list.rows).toHaveBeenCalledOnce()
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
        {
          id: "handed-back",
          label: "Needs reassignment",
          href: "/admin/tasks",
          count: 2,
          preview: { rows: ROWS, linkLabel: "Reassign in Tasks" },
        },
        { id: "fixture", label: "Fixture", href: "/admin/fixture", count: 0 },
      ],
    })
  })

  it("gives a list card with no rows a count of 0", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    counts[0].count.mockResolvedValue(0)
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue([])

    const rendered = (await renderCards()) as unknown as ReactElement<{
      cards: { id: string; count: number }[]
    }>

    expect(
      rendered.props.cards.find((card) => card.id === "handed-back")?.count
    ).toBe(0)
  })

  it.each([
    ["a count", () => counts[0].count],
    ["a list's rows", () => list.rows],
  ])("lets a throwing read throw (Next's error page): %s", async (_, read) => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    const failure = new Error("read failed")
    counts[0].count.mockResolvedValue(0)
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue([])
    read().mockRejectedValue(failure)

    await expect(renderCards()).rejects.toBe(failure)
  })

  it("runs the admin check first and reads no count when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /dashboard")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminHomePage()).rejects.toBe(redirectError)
    for (const { count } of counts) expect(count).not.toHaveBeenCalled()
    expect(list.rows).not.toHaveBeenCalled()
  })
})
