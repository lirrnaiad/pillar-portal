// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import type { TaskCardData } from "../queries"
import { PlannerChip } from "./planner-chip"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const TASK: TaskCardData = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Masthead brief",
  ownerName: "Layout",
  // Sat, Oct 10 2026, 5:00 PM in Manila.
  dueAt: "2026-10-10T09:00:00+00:00",
  column: "to_do",
  overdue: false,
  hasAwaitingResponse: false,
  hasNeedsReassignment: false,
  assignees: [],
}

const glyphOf = (link: HTMLElement) => link.querySelector("svg")

describe("PlannerChip", () => {
  it("links to Task detail, named by the title, the status and the PHT due time", () => {
    render(<PlannerChip task={TASK} />)

    const link = screen.getByRole("link", {
      name: "Masthead brief, To Do, due Sat, Oct 10 at 5:00 PM",
    })
    expect(link).toHaveAttribute("href", `/dashboard/tasks/${TASK.id}`)
    expect(link.tagName).toBe("A")
    // A card pill with the card shadow, at least 28px tall.
    expect(link).toHaveClass(
      "bg-card",
      "shadow-card",
      "rounded-full",
      "min-h-7"
    )
  })

  it("shows the title truncated to one line after the glyph", () => {
    render(<PlannerChip task={TASK} />)

    const link = screen.getByRole("link")
    const title = screen.getByText("Masthead brief")
    expect(title).toHaveClass("truncate")
    expect(link.firstElementChild?.tagName.toLowerCase()).toBe("svg")
  })

  it.each([
    ["to_do", false, "lucide-circle", "text-muted-foreground", "To Do"],
    ["doing", false, "lucide-circle-dot", "text-status-progress", "Doing"],
    [
      "for_review",
      false,
      "lucide-circle-dot",
      "text-status-progress",
      "For Review",
    ],
    ["done", false, "lucide-circle-check", "text-status-positive", "Done"],
    ["doing", true, "lucide-circle-alert", "text-status-attention", "Overdue"],
  ] as const)(
    "shows %s (overdue: %s) as a 12px hidden %s glyph in %s",
    (column, overdue, glyph, color, status) => {
      render(<PlannerChip task={{ ...TASK, column, overdue }} />)

      const link = screen.getByRole("link", {
        name: `Masthead brief, ${status}, due Sat, Oct 10 at 5:00 PM`,
      })
      const svg = glyphOf(link)
      expect(svg).toHaveClass(glyph, color, "size-3")
      expect(svg).toHaveAttribute("aria-hidden", "true")
    }
  )

  it("has no axe violations", async () => {
    const { container } = render(
      <ul>
        <li>
          <PlannerChip task={TASK} />
        </li>
        <li>
          <PlannerChip task={{ ...TASK, id: "x", overdue: true }} />
        </li>
      </ul>
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
