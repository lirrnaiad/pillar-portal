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
import { afterEach, describe, expect, it, vi } from "vitest"

import type { TaskCardData } from "../queries/shared"
import { ReviewQueue } from "./review-queue"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  markDoneAction,
  sendBackTaskAction,
  reopenTaskAction,
  refresh,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  markDoneAction: vi.fn(),
  sendBackTaskAction: vi.fn(),
  reopenTaskAction: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("../actions", () => ({
  markDoneAction,
  sendBackTaskAction,
  reopenTaskAction,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

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

const STALE =
  "Something changed since you opened this. Review the latest and try again."

const card = (n: number, title: string): TaskCardData => ({
  id: `00000000-0000-4000-8000-00000000004${n}`,
  title,
  ownerName: "Layout",
  dueAt: `2099-01-${String(n).padStart(2, "0")}T00:00:00+00:00`,
  column: "for_review",
  overdue: false,
  sentBack: false,
  hasAwaitingResponse: false,
  hasNeedsReassignment: false,
  assignees: [],
})

const SPREAD = card(1, "Lay out the spread")
const COLUMN = card(2, "Write the column")

// /admin/tasks as it renders the queue: its h1 is the focus target.
function Page({ tasks }: { tasks: TaskCardData[] }) {
  return (
    <main>
      <h1 id="admin-tasks-heading" tabIndex={-1}>
        Tasks
      </h1>
      <ReviewQueue tasks={tasks} focusTargetId="admin-tasks-heading" />
    </main>
  )
}

const heading = () => document.getElementById("admin-tasks-heading")!
const markDone = (title: string) =>
  screen.getByRole("button", { name: `Mark done, ${title}` })
const sendBack = (title: string) =>
  screen.getByRole("button", { name: `Send back with note, ${title}` })

describe("ReviewQueue", () => {
  it("renders nothing for an empty queue", () => {
    const { container } = render(
      <ReviewQueue tasks={[]} focusTargetId="admin-tasks-heading" />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("shows a section headed 'Waiting for your review (n)', one card per task in the order given", () => {
    render(<Page tasks={[SPREAD, COLUMN]} />)

    const section = screen.getByRole("region", {
      name: "Waiting for your review (2)",
    })
    expect(
      within(section).getByRole("heading", {
        level: 2,
        name: "Waiting for your review (2)",
      })
    ).toBeInTheDocument()
    expect(
      within(section)
        .getAllByRole("heading", { level: 3 })
        .map((title) => title.textContent)
    ).toEqual(["Lay out the spread", "Write the column"])
  })

  it("gives each card Mark done and Send back with note named for its task, and no Reopen", () => {
    render(<Page tasks={[SPREAD, COLUMN]} />)

    for (const title of ["Lay out the spread", "Write the column"]) {
      expect(markDone(title)).toHaveTextContent(/^Mark done$/)
      expect(sendBack(title)).toHaveTextContent(/^Send back with note$/)
    }
    expect(screen.queryByRole("button", { name: /Reopen/ })).toBeNull()
  })

  it("marks a row done, toasts, focuses the h1, and the row leaves with the count", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    const { rerender } = render(<Page tasks={[SPREAD, COLUMN]} />)

    await user.click(markDone("Lay out the spread"))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    expect(markDoneAction).toHaveBeenCalledExactlyOnceWith({
      taskId: SPREAD.id,
    })
    expect(heading()).toHaveFocus()

    // What revalidation hands back.
    rerender(<Page tasks={[COLUMN]} />)
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Waiting for your review (1)",
      })
    ).toBeInTheDocument()
    expect(screen.queryByText("Lay out the spread")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("leaves focus where the admin moved it while Mark done saved", async () => {
    const user = userEvent.setup()
    let settle: (value: unknown) => void = () => {}
    markDoneAction.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    render(<Page tasks={[SPREAD, COLUMN]} />)

    await user.click(markDone("Lay out the spread"))
    await waitFor(() =>
      expect(markDone("Lay out the spread")).toHaveAttribute(
        "aria-disabled",
        "true"
      )
    )
    // On to the next row while the first one saves.
    markDone("Write the column").focus()

    settle({ ok: true, data: { column: "done" } })

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    expect(markDone("Write the column")).toHaveFocus()
    expect(heading()).not.toHaveFocus()
  })

  it("sends a row back with its note, toasts, closes the dialog and focuses the h1", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({
      ok: true,
      data: { column: "doing" },
    })
    const { rerender } = render(<Page tasks={[SPREAD, COLUMN]} />)

    await user.click(sendBack("Write the column"))
    await user.type(screen.getByLabelText("Note"), "Tighten the lede")
    await user.click(screen.getByRole("button", { name: "Send back" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent back."))
    expect(sendBackTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: COLUMN.id,
      note: "Tighten the lede",
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(heading()).toHaveFocus())

    rerender(<Page tasks={[SPREAD]} />)
    expect(screen.queryByText("Write the column")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("leaves the section out once the last row leaves", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    const { rerender } = render(<Page tasks={[SPREAD]} />)

    await user.click(markDone("Lay out the spread"))
    await waitFor(() => expect(heading()).toHaveFocus())

    rerender(<Page tasks={[]} />)
    expect(screen.queryByRole("region")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("shows the stale line, refreshes, and focuses the h1 when the refresh takes the row away", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<Page tasks={[SPREAD, COLUMN]} />)

    await user.click(markDone("Lay out the spread"))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalledOnce()
    expect(toastSuccess).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(markDone("Lay out the spread")).not.toHaveAttribute(
        "aria-disabled"
      )
    )

    rerender(<Page tasks={[COLUMN]} />)
    expect(screen.queryByText("Lay out the spread")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("drops an open Send back dialog and its note when a stale refresh takes the row away", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<Page tasks={[SPREAD, COLUMN]} />)

    await user.click(sendBack("Write the column"))
    await user.type(screen.getByLabelText("Note"), "Tighten the lede")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    rerender(<Page tasks={[SPREAD]} />)

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByDisplayValue("Tighten the lede")).toBeNull()
    await waitFor(() => expect(heading()).toHaveFocus())
  })

  it("shows the blank-note error inline and calls nothing", async () => {
    const user = userEvent.setup()
    render(<Page tasks={[SPREAD]} />)

    await user.click(sendBack("Lay out the spread"))
    await user.click(screen.getByRole("button", { name: "Send back" }))

    expect(
      screen.getByText("Add a note so they know what to fix.")
    ).toBeInTheDocument()
    expect(sendBackTaskAction).not.toHaveBeenCalled()
  })

  it("has no axe violations", async () => {
    const { container } = render(<Page tasks={[SPREAD, COLUMN]} />)

    expect(await axeViolations(container)).toEqual([])
  })
})
