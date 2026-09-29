// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BoardCard } from "../queries"
import { TaskBoard } from "./task-board"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { moveTaskAction, refresh, toastError } = vi.hoisted(() => ({
  moveTaskAction: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../actions", () => ({ moveTaskAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

// jsdom implements neither PointerEvent capture nor scrollIntoView, which
// Radix's Select relies on to open/scroll its portal content.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function card(
  n: number,
  overrides: Partial<BoardCard> & { title: string }
): BoardCard {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    ownerName: "Layout",
    dueAt: "2099-01-01T00:00:00+00:00",
    column: "to_do",
    overdue: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
    allowedMoves: [],
    ...overrides,
  }
}

const SPREAD = card(1, {
  title: "Lay out the spread",
  column: "to_do",
  allowedMoves: ["doing"],
})
const CARTOON = card(2, {
  title: "Draw the cartoon",
  column: "to_do",
  allowedMoves: [],
})
const PHOTOS = card(3, {
  title: "Edit the photos",
  column: "doing",
  allowedMoves: ["to_do", "for_review"],
})
const CARDS = [SPREAD, CARTOON, PHOTOS]

// A column's region is named by its heading, which reads "<label>, n tasks" (the visible count is aria-hidden).
const column = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label}\\s*,`) })

const moveSelect = (title: string) =>
  screen.getByRole("combobox", { name: `Move to…, ${title}` })

async function chooseMove(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  optionName: string
) {
  await user.click(moveSelect(title))
  await user.click(await screen.findByRole("option", { name: optionName }))
}

// An action call that stays pending until the test settles it.
function pendingCall() {
  let settle: (value: unknown) => void = () => {}
  moveTaskAction.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

describe("TaskBoard", () => {
  it("shows four columns in order, each headed with its label and count", () => {
    render(<TaskBoard cards={CARDS} />)

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      "To Do2, 2 tasks",
      "Doing1, 1 task",
      "For Review0, 0 tasks",
      "Done0, 0 tasks",
    ])
  })

  it("lists each column's cards in the order given, as h3 titles", () => {
    render(<TaskBoard cards={CARDS} />)

    const titles = within(column("To Do"))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent)
    expect(titles).toEqual(["Lay out the spread", "Draw the cartoon"])
  })

  it("shows a faint 'Nothing here' in an empty column", () => {
    render(<TaskBoard cards={CARDS} />)

    expect(within(column("For Review")).getByText("Nothing here")).toBeVisible()
    expect(within(column("Done")).getByText("Nothing here")).toBeVisible()
    expect(within(column("To Do")).queryByText("Nothing here")).toBeNull()
  })

  it("puts the columns in one focusable, named region so a keyboard can scroll it", () => {
    render(<TaskBoard cards={CARDS} />)

    const row = screen.getByRole("region", { name: "Board columns" })
    expect(row).toHaveAttribute("tabindex", "0")
    expect(row).toHaveClass("overflow-x-auto")
  })

  it("gives only a movable card a select and the drag wiring, and every card a link", () => {
    render(<TaskBoard cards={CARDS} />)

    expect(moveSelect("Lay out the spread")).toBeInTheDocument()
    expect(moveSelect("Edit the photos")).toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Move to…, Draw the cartoon" })
    ).toBeNull()
    expect(screen.getAllByRole("combobox")).toHaveLength(2)

    const wired = (title: string) =>
      screen.getByRole("link", { name: title }).hasAttribute("aria-describedby")
    expect(wired("Lay out the spread")).toBe(true)
    expect(wired("Edit the photos")).toBe(true)
    expect(wired("Draw the cartoon")).toBe(false)
    expect(
      screen.getByRole("link", { name: "Draw the cartoon" })
    ).toHaveAttribute("href", `/dashboard/tasks/${CARTOON.id}`)
  })

  it("lists exactly the card's allowedMoves in its select", async () => {
    const user = userEvent.setup()
    render(<TaskBoard cards={CARDS} />)

    await user.click(moveSelect("Edit the photos"))

    const options = await screen.findAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "To Do",
      "For Review",
    ])
  })

  it("moves a card at once on a select move, updating both counts, and focuses its select", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    render(<TaskBoard cards={CARDS} />)

    await chooseMove(user, "Lay out the spread", "Doing")

    // Still saving: the move already shows.
    expect(moveTaskAction).toHaveBeenCalledWith({
      taskId: SPREAD.id,
      toColumn: "doing",
    })
    expect(
      within(column("Doing")).getByRole("heading", {
        level: 3,
        name: "Lay out the spread",
      })
    ).toBeInTheDocument()
    expect(within(column("To Do")).queryByText("Lay out the spread")).toBeNull()
    expect(
      screen.getByRole("heading", { level: 2, name: /^To Do.*1 task$/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { level: 2, name: /^Doing.*2 tasks$/ })
    ).toBeInTheDocument()
    await waitFor(() => expect(moveSelect("Lay out the spread")).toHaveFocus())

    settle({ ok: true, data: { column: "doing" } })
    await waitFor(() =>
      expect(moveSelect("Lay out the spread")).not.toHaveAttribute(
        "aria-disabled"
      )
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("puts a refused move back, toasts the copy, refreshes and refocuses the select", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockResolvedValue({ ok: false, code: "tasks.not_allowed" })
    render(<TaskBoard cards={CARDS} />)

    await chooseMove(user, "Lay out the spread", "Doing")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(
        within(column("To Do")).getByRole("heading", {
          level: 3,
          name: "Lay out the spread",
        })
      ).toBeInTheDocument()
    )
    expect(within(column("Doing")).queryByText("Lay out the spread")).toBeNull()
    await waitFor(() => expect(moveSelect("Lay out the spread")).toHaveFocus())
  })

  it("treats a thrown call like a refusal", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockRejectedValue(new Error("network"))
    render(<TaskBoard cards={CARDS} />)

    await chooseMove(user, "Lay out the spread", "Doing")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(
        within(column("To Do")).getByText("Lay out the spread")
      ).toBeInTheDocument()
    )
  })

  it("ignores another move while one saves, on every card", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    render(<TaskBoard cards={CARDS} />)

    await chooseMove(user, "Lay out the spread", "Doing")
    expect(moveSelect("Edit the photos")).toHaveAttribute(
      "aria-disabled",
      "true"
    )

    await user.click(moveSelect("Edit the photos"))
    expect(screen.queryByRole("option")).toBeNull()
    expect(moveTaskAction).toHaveBeenCalledTimes(1)

    settle({ ok: true, data: { column: "doing" } })
    await waitFor(() =>
      expect(moveSelect("Edit the photos")).not.toHaveAttribute("aria-disabled")
    )
  })

  it("has no axe violations", async () => {
    const { container } = render(<TaskBoard cards={CARDS} />)

    expect(await axeViolations(container)).toEqual([])
  })
})
