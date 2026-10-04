// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import type { TaskCardData } from "../queries"
import { TaskCard } from "./task-card"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const assignee = (n: number, name: string, initials: string) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  initials,
})

const TASK: TaskCardData = {
  id: "00000000-0000-4000-8000-000000000021",
  title: "Lay out the spread",
  ownerName: "Layout",
  // 23:30 PHT on Saturday, October 31, 2026.
  dueAt: "2026-10-31T15:30:00+00:00",
  column: "doing",
  overdue: false,
  hasAwaitingResponse: false,
  hasNeedsReassignment: false,
  assignees: [assignee(1, "Sam Layout", "SL")],
}

describe("TaskCard", () => {
  it("spreads titleLinkProps onto the title link, and adds nothing without them", () => {
    const { rerender } = render(<TaskCard task={TASK} />)
    const plain = screen.getByRole("link", { name: "Lay out the spread" })
    expect(plain).not.toHaveAttribute("aria-describedby")
    expect(plain).not.toHaveAttribute("draggable")

    const ref = { current: null as HTMLAnchorElement | null }
    rerender(
      <TaskCard
        task={TASK}
        titleLinkProps={{
          ref,
          "aria-describedby": "dnd-instructions",
          draggable: false,
        }}
      />
    )
    const link = screen.getByRole("link", { name: "Lay out the spread" })
    expect(link).toHaveAttribute("aria-describedby", "dnd-instructions")
    expect(link).toHaveAttribute("draggable", "false")
    expect(ref.current).toBe(link)
  })

  it("links to Task detail, named by the title alone", () => {
    render(<TaskCard task={TASK} />)

    const link = screen.getByRole("link", { name: "Lay out the spread" })
    expect(link).toHaveAttribute("href", `/dashboard/tasks/${TASK.id}`)
    expect(
      screen.getByRole("heading", { level: 3, name: "Lay out the spread" })
    ).toBeInTheDocument()
  })

  it("titles the card h4 when asked, for cards under an h3", () => {
    render(<TaskCard task={TASK} headingLevel={4} />)

    expect(
      screen.getByRole("heading", { level: 4, name: "Lay out the spread" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull()
  })

  it("shows the owner, the PHT due date and the column with its label", () => {
    render(<TaskCard task={TASK} />)

    expect(screen.getByText(/Layout · Due/).textContent).toContain(
      "Sat, Oct 31, 11:30 PM"
    )
    expect(screen.getByText("Doing")).toBeInTheDocument()
  })

  it("shows no badge when nothing calls for one", () => {
    render(<TaskCard task={TASK} />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("shows Awaiting response, Needs reassignment and Overdue when they apply", () => {
    render(
      <TaskCard
        task={{
          ...TASK,
          overdue: true,
          hasAwaitingResponse: true,
          hasNeedsReassignment: true,
        }}
      />
    )

    expect(
      screen.getByRole("img", { name: "Status: Awaiting response" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: "Status: Needs reassignment" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: "Status: Overdue" })
    ).toBeInTheDocument()
  })

  it("shows at most three avatars and then +n, with every name read out", () => {
    const assignees = [
      assignee(1, "Ann Able", "AA"),
      assignee(2, "Ben Baker", "BB"),
      assignee(3, "Cal Cruz", "CC"),
      assignee(4, "Dee Diaz", "DD"),
      assignee(5, "Eli Eng", "EE"),
    ]
    render(<TaskCard task={{ ...TASK, assignees }} />)

    expect(screen.getByText("AA")).toBeInTheDocument()
    expect(screen.getByText("CC")).toBeInTheDocument()
    expect(screen.queryByText("DD")).not.toBeInTheDocument()
    expect(screen.getByText("+2")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Assigned to Ann Able, Ben Baker, Cal Cruz, Dee Diaz, Eli Eng"
      )
    ).toHaveClass("sr-only")
  })

  it("renders children outside the link", () => {
    render(
      <TaskCard task={TASK}>
        <button type="button">Answer</button>
      </TaskCard>
    )

    const link = screen.getByRole("link", { name: "Lay out the spread" })
    expect(link).not.toContainElement(screen.getByRole("button"))
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <TaskCard task={{ ...TASK, hasAwaitingResponse: true, overdue: true }} />
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
