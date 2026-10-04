// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import type { TaskCardData } from "../queries"
import { PlannerDayList } from "./planner-day-list"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

let nextId = 0
function task(title: string, dueAt: string): TaskCardData {
  nextId += 1
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    title,
    ownerName: "Layout",
    dueAt,
    column: "doing",
    overdue: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
  }
}

// Sat, Oct 3 and Tue, Oct 20 2026, in Manila.
const TASKS = [
  task("Masthead brief", "2026-10-03T09:00:00Z"),
  task("Spread proof", "2026-10-20T01:00:00Z"),
  task("Cover art", "2026-10-20T09:00:00Z"),
]

const triggers = () => screen.getAllByRole("button")
const names = () =>
  triggers().map((trigger) => trigger.getAttribute("aria-label"))

describe("PlannerDayList", () => {
  it("lists the days with deadlines plus today, in date order, with only today expanded", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-08" tasks={TASKS} />)

    expect(names()).toEqual([
      "Sat, Oct 3, 1 deadline",
      "Thu, Oct 8 · Today, No deadlines",
      "Tue, Oct 20, 2 deadlines",
    ])
    expect(
      triggers().map((trigger) => trigger.getAttribute("aria-expanded"))
    ).toEqual(["false", "true", "false"])
  })

  it("names each 44px trigger by its day and count", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-08" tasks={TASKS} />)

    const today = screen.getByRole("button", {
      name: "Thu, Oct 8 · Today, No deadlines",
    })
    expect(today).toHaveClass("min-h-11")
    // The name repeats what the trigger shows, in the same order.
    expect(
      [...today.querySelectorAll("span span")].map((span) => span.textContent)
    ).toEqual(["Thu, Oct 8 · Today", "No deadlines"])
  })

  it("keeps today's row where its deadlines put it when it has some", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />)

    expect(names()).toEqual([
      "Sat, Oct 3, 1 deadline",
      "Tue, Oct 20 · Today, 2 deadlines",
    ])
    const region = screen.getByRole("region", {
      name: "Tue, Oct 20 · Today, 2 deadlines",
    })
    // Each day is an h3 (Radix's accordion header); its cards are h4s.
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => within(heading).getByRole("button").textContent)
    ).toHaveLength(2)
    expect(
      within(region)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(["Spread proof", "Cover art"])
    expect(within(region).queryByRole("heading", { level: 3 })).toBeNull()
  })

  it("expands none, and adds no today row, in another month", () => {
    render(<PlannerDayList month="2026-10" today="2026-11-05" tasks={TASKS} />)

    expect(names()).toEqual([
      "Sat, Oct 3, 1 deadline",
      "Tue, Oct 20, 2 deadlines",
    ])
    for (const trigger of triggers()) {
      expect(trigger).toHaveAttribute("aria-expanded", "false")
    }
  })

  it("opens a day's panel of task cards, each linking to Task detail", async () => {
    const user = userEvent.setup()
    render(<PlannerDayList month="2026-10" today="2026-10-08" tasks={TASKS} />)

    await user.click(
      screen.getByRole("button", { name: "Tue, Oct 20, 2 deadlines" })
    )

    const region = screen.getByRole("region", {
      name: "Tue, Oct 20, 2 deadlines",
    })
    expect(
      within(region).getByRole("link", { name: "Cover art" })
    ).toHaveAttribute("href", `/dashboard/tasks/${TASKS[2].id}`)
    // The panel's wrapper undoes the generated defaults a task card can't
    // take: a fixed measured height (which clips a card that rewraps after
    // opening), underlined links and spaced paragraphs.
    const wrapper = region.firstElementChild
    expect(wrapper).toHaveClass(
      "h-auto",
      "[&_a]:no-underline",
      "[&_p:not(:last-child)]:mb-0"
    )
    // One at a time: `not.toHaveClass(a, b)` passes when any one is missing.
    for (const generated of [
      "h-(--radix-accordion-content-height)",
      "[&_a]:underline",
      "[&_p:not(:last-child)]:mb-4",
    ]) {
      expect(wrapper).not.toHaveClass(generated)
    }
    // Both today and Oct 20 stay open: the accordion takes several.
    expect(
      screen.getByRole("button", { name: "Thu, Oct 8 · Today, No deadlines" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
