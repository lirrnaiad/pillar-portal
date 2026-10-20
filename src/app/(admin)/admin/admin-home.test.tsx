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

afterEach(cleanup)

describe("AdminHomeCards", () => {
  it("renders one card link per count above 0, reading its count as text", async () => {
    const { container } = render(<AdminHomeCards cards={[APPROVALS]} />)

    const list = screen.getByRole("list")
    expect(list).toHaveClass("grid", "sm:grid-cols-2", "lg:grid-cols-3")
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
