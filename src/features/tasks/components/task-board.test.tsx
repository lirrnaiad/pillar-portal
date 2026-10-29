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

import type { BoardCard } from "../queries/board"
import { TaskBoard } from "./task-board"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { moveTaskAction, markDoneAction, refresh, toastError, toastSuccess } =
  vi.hoisted(() => ({
    moveTaskAction: vi.fn(),
    markDoneAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  }))

vi.mock("../actions", () => ({ moveTaskAction, markDoneAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

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
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
    moves: [],
    ...overrides,
  }
}

const SPREAD = card(1, {
  title: "Lay out the spread",
  column: "to_do",
  moves: ["doing"],
})
const CARTOON = card(2, {
  title: "Draw the cartoon",
  column: "to_do",
  moves: [],
})
const PHOTOS = card(3, {
  title: "Edit the photos",
  column: "doing",
  moves: ["to_do", "for_review"],
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
function pendingCall(action: ReturnType<typeof vi.fn> = moveTaskAction) {
  let settle: (value: unknown) => void = () => {}
  action.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

const STALE =
  "Something changed since you opened this. Review the latest and try again."

// A For Review card: its approver's moves end with Done (can_review), an
// assignee's never do.
const REVIEWED = card(5, {
  title: "Check the proofs",
  column: "for_review",
  moves: ["done"],
})
const ASSIGNED = card(6, {
  title: "Caption the photos",
  column: "for_review",
  moves: ["to_do", "doing"],
})

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
    // The containing block of the sr-only text inside it; otherwise that
    // absolutely positioned text escapes the row and widens the page.
    expect(row).toHaveClass("relative")
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

  it("lists exactly the card's moves in its select", async () => {
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
    // Board moves other than Done are silent.
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(markDoneAction).not.toHaveBeenCalled()
  })

  it("offers Done in a For Review card's select only when its moves hold it", async () => {
    const user = userEvent.setup()
    render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

    await user.click(moveSelect("Check the proofs"))
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent)
    ).toEqual(["Done"])
    await user.keyboard("{Escape}")

    await user.click(moveSelect("Caption the photos"))
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent)
    ).toEqual(["To Do", "Doing"])
  })

  it("puts focus on the card's title link once a select move to Done leaves it with no select", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(markDoneAction)
    const { rerender } = render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

    await chooseMove(user, "Check the proofs", "Done")
    await waitFor(() => expect(moveSelect("Check the proofs")).toHaveFocus())

    settle({ ok: true, data: { column: "done" } })
    // What revalidation hands back: Done, with nothing more to offer.
    rerender(
      <TaskBoard
        cards={[{ ...REVIEWED, column: "done", moves: [] }, ASSIGNED]}
      />
    )

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    const moved = within(column("Done")).getByRole("article")
    expect(within(moved).queryByRole("combobox")).toBeNull()
    await waitFor(() =>
      expect(
        within(moved).getByRole("link", { name: "Check the proofs" })
      ).toHaveFocus()
    )
  })

  it("moves a card to Done at once through markDoneAction, never moveTaskAction, and toasts once saved", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(markDoneAction)
    render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

    await chooseMove(user, "Check the proofs", "Done")

    // Still saving: the move already shows, and nothing is toasted yet.
    expect(markDoneAction).toHaveBeenCalledExactlyOnceWith({
      taskId: REVIEWED.id,
    })
    expect(moveTaskAction).not.toHaveBeenCalled()
    expect(
      within(column("Done")).getByRole("heading", {
        level: 3,
        name: "Check the proofs",
      })
    ).toBeInTheDocument()
    expect(
      within(column("For Review")).queryByText("Check the proofs")
    ).toBeNull()
    expect(toastSuccess).not.toHaveBeenCalled()

    settle({ ok: true, data: { column: "done" } })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith("Marked done.")
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["tasks.stale", STALE],
  ])(
    "puts a Done move refused with %s back, toasts its copy and refreshes",
    async (code, copy) => {
      const user = userEvent.setup()
      markDoneAction.mockResolvedValue({ ok: false, code })
      render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

      await chooseMove(user, "Check the proofs", "Done")

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).toHaveBeenCalledOnce()
      await waitFor(() =>
        expect(
          within(column("For Review")).getByRole("heading", {
            level: 3,
            name: "Check the proofs",
          })
        ).toBeInTheDocument()
      )
      expect(within(column("Done")).queryByText("Check the proofs")).toBeNull()
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(moveTaskAction).not.toHaveBeenCalled()
    }
  )

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

  it('shows a sent-back card\'s new column, not "Sent back", while its move saves, and "Sent back" again once the move is refused', async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    const sentBack = card(4, {
      title: "Fix the captions",
      column: "doing",
      sentBack: true,
      moves: ["for_review"],
    })
    render(<TaskBoard cards={[sentBack]} />)

    const cardIn = (label: string) => within(column(label)).getByRole("article")
    expect(within(cardIn("Doing")).getByText("Sent back")).toBeInTheDocument()

    await chooseMove(user, "Fix the captions", "For Review")

    // Still saving: the move clears the note, so the card reads its new
    // column.
    const moved = cardIn("For Review")
    expect(within(moved).getByText("For Review")).toBeInTheDocument()
    expect(within(moved).queryByText("Sent back")).toBeNull()

    settle({ ok: false, code: "tasks.not_allowed" })
    await waitFor(() =>
      expect(within(cardIn("Doing")).getByText("Sent back")).toBeInTheDocument()
    )
    expect(within(column("For Review")).queryByRole("article")).toBeNull()
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

  it("rolls back and toasts offline without re-reading the page", async () => {
    const user = userEvent.setup()
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    moveTaskAction.mockRejectedValue(new TypeError("Failed to fetch"))
    render(<TaskBoard cards={CARDS} />)

    await chooseMove(user, "Lay out the spread", "Doing")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    await waitFor(() =>
      expect(
        within(column("To Do")).getByText("Lay out the spread")
      ).toBeInTheDocument()
    )
    // Offline, a re-read would make Next.js fall back to a full navigation.
    expect(refresh).not.toHaveBeenCalled()
    onLine.mockRestore()
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
