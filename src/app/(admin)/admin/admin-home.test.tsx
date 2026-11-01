// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { AdminHomeCards, type AdminHomeCard } from "./admin-home"
import { AdminHomeSkeleton } from "./admin-home-skeleton"

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const APPROVALS: AdminHomeCard = {
  id: "pending-approvals",
  label: "Awaiting approval",
  href: "/admin/members",
  count: 2,
}
// A second kind, standing in for the cards later stories add.
const FIXTURE: AdminHomeCard = {
  id: "fixture",
  label: "Fixture",
  href: "/admin/fixture",
  count: 0,
}

// Needs reassignment, a list card: seven rows, the second without a reason.
const ROWS = Array.from({ length: 7 }, (_, i) => ({
  id: `row-${i + 1}`,
  text: `Task ${i + 1} · Cartoonist · Editor-in-Chief`,
  reason: i === 1 ? null : `Reason ${i + 1}`,
}))
const HANDED_BACK: AdminHomeCard = {
  id: "handed-back",
  label: "Needs reassignment",
  href: "/admin/tasks",
  count: 7,
  preview: { rows: ROWS, linkLabel: "Reassign in Tasks" },
}

// The cards (the outer list's items), and a list card's rows (its own list).
const cardItems = () =>
  Array.from(screen.getAllByRole("list")[0].children) as HTMLElement[]
const previewRows = () =>
  within(screen.getAllByRole("list")[1]).getAllByRole("listitem")

afterEach(cleanup)

describe("AdminHomeCards", () => {
  it("renders one card link per count above 0, reading its count as text", async () => {
    const { container } = render(<AdminHomeCards cards={[APPROVALS]} />)

    const list = screen.getByRole("list")
    expect(list).toHaveClass(
      "grid",
      "items-start",
      "sm:grid-cols-2",
      "lg:grid-cols-3"
    )
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(1)
    const link = within(items[0]).getByRole("link")
    expect(link).toHaveAccessibleName("Awaiting approval (2)")
    expect(link).toHaveTextContent(/^Awaiting approval \(2\)$/)
    expect(link).toHaveAttribute("href", "/admin/members")
    // A 44px target with the card look.
    expect(link).toHaveClass(
      "min-h-11",
      "rounded-lg",
      "bg-card",
      "p-card-padding",
      "shadow-card"
    )
    expect(
      screen.queryByText("Nothing needs you right now.")
    ).not.toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it("hides a card whose count is 0 and keeps the order of the rest", () => {
    render(
      <AdminHomeCards
        cards={[
          { ...FIXTURE, id: "a", label: "First", count: 1 },
          FIXTURE,
          APPROVALS,
        ]}
      />
    )

    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "First (1)",
      "Awaiting approval (2)",
    ])
  })

  it.each([
    ["every count is 0", [{ ...APPROVALS, count: 0 }, FIXTURE]],
    ["there are no cards", []],
  ])(
    "shows only the all-clear heading when %s",
    async (_, cards: AdminHomeCard[]) => {
      const { container } = render(<AdminHomeCards cards={cards} />)

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Nothing needs you right now.",
        })
      ).toHaveClass("text-heading-sm")
      expect(screen.queryByRole("list")).not.toBeInTheDocument()
      expect(screen.queryByRole("link")).not.toBeInTheDocument()
      expect(await axeViolations(container)).toEqual([])
    }
  )
})

describe("AdminHomeCards' list card", () => {
  it("heads the card 'Needs reassignment (n)', n counting every row, and lists the first five", async () => {
    const { container } = render(<AdminHomeCards cards={[HANDED_BACK]} />)

    expect(cardItems()).toHaveLength(1)
    const [card] = cardItems()
    expect(
      within(card).getByRole("heading", {
        level: 2,
        name: "Needs reassignment (7)",
      })
    ).toHaveClass("text-heading-sm")
    const rows = previewRows()
    expect(card).toContainElement(rows[0])
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Task 1 · Cartoonist · Editor-in-Chief",
      "Task 2 · Cartoonist · Editor-in-Chief",
      "Task 3 · Cartoonist · Editor-in-Chief",
      "Task 4 · Cartoonist · Editor-in-Chief",
      "Task 5 · Cartoonist · Editor-in-Chief",
    ])
    expect(screen.queryByText(/^Task 6/)).toBeNull()
    expect(await axeViolations(container)).toEqual([])
  })

  it("shows a row's reason under it only when given", () => {
    render(<AdminHomeCards cards={[HANDED_BACK]} />)

    const rows = previewRows()
    expect(within(rows[0]).getByText("Reason: Reason 1")).toBeInTheDocument()
    expect(within(rows[1]).queryByText(/^Reason:/)).toBeNull()
    expect(rows[1]).toHaveTextContent(/^Task 2 · Cartoonist · Editor-in-Chief$/)
  })

  it("isn't one link: only 'Reassign in Tasks' links, to /admin/tasks, as a 44px target", () => {
    render(<AdminHomeCards cards={[HANDED_BACK]} />)

    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName("Reassign in Tasks")
    expect(links[0]).toHaveAttribute("href", "/admin/tasks")
    expect(links[0]).toHaveClass("min-h-11")
    // The card keeps the card look.
    expect(links[0].parentElement).toHaveClass(
      "rounded-lg",
      "bg-card",
      "p-card-padding",
      "shadow-card"
    )
  })

  it("sits in the cards' order between link cards, which stay one link each", () => {
    render(
      <AdminHomeCards
        cards={[
          APPROVALS,
          HANDED_BACK,
          {
            id: "review-queue",
            label: "Waiting for your review",
            href: "/admin/tasks",
            count: 1,
          },
        ]}
      />
    )

    // Each card keeps its own height: the link cards don't stretch to the
    // taller list card's.
    expect(screen.getAllByRole("list")[0]).toHaveClass("items-start")
    const cards = cardItems()
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole("link")).toHaveAccessibleName(
      "Awaiting approval (2)"
    )
    expect(
      within(cards[1]).getByRole("heading", { name: "Needs reassignment (7)" })
    ).toBeInTheDocument()
    expect(within(cards[2]).getByRole("link")).toHaveAccessibleName(
      "Waiting for your review (1)"
    )
  })

  it("lists every row when there are five or fewer", () => {
    render(
      <AdminHomeCards
        cards={[
          {
            ...HANDED_BACK,
            count: 2,
            preview: { ...HANDED_BACK.preview!, rows: ROWS.slice(0, 2) },
          },
        ]}
      />
    )

    expect(
      screen.getByRole("heading", { name: "Needs reassignment (2)" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Task 2 · Cartoonist · Editor-in-Chief")
    ).toBeInTheDocument()
  })

  it("is hidden at 0, and leaves the all-clear when nothing else needs the admin", () => {
    render(
      <AdminHomeCards
        cards={[
          { ...APPROVALS, count: 0 },
          {
            ...HANDED_BACK,
            count: 0,
            preview: { rows: [], linkLabel: "Reassign in Tasks" },
          },
        ]}
      />
    )

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Nothing needs you right now.",
      })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Needs reassignment/)).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("counts toward the all-clear: shown alone, it replaces it", () => {
    render(<AdminHomeCards cards={[{ ...APPROVALS, count: 0 }, HANDED_BACK]} />)

    expect(
      screen.queryByText("Nothing needs you right now.")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Needs reassignment (7)" })
    ).toBeInTheDocument()
  })
})

describe("AdminHomeSkeleton", () => {
  it("is a busy status announcing the load", async () => {
    const { container } = render(<AdminHomeSkeleton />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading admin home")
    expect(within(status).getByText("Loading admin home")).toHaveClass(
      "sr-only"
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
