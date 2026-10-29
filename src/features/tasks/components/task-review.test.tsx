// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskReview } from "./task-review"

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

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const STALE =
  "Something changed since you opened this. Review the latest and try again."

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

// Task detail's status (TaskColumnControl's), where focus goes after a save.
function Page({
  canReview = false,
  canReopen = false,
}: {
  canReview?: boolean
  canReopen?: boolean
}) {
  return (
    <main>
      <p id="task-status" tabIndex={-1}>
        Status: For Review
      </p>
      <TaskReview
        taskId={TASK_ID}
        canReview={canReview}
        canReopen={canReopen}
        focusTargetId="task-status"
      />
    </main>
  )
}

// A list of tasks (the review queue): its own focus target, and buttons
// named for their task.
function ListPage({ shown = true }: { shown?: boolean }) {
  return (
    <main>
      <h1 id="list-heading" tabIndex={-1}>
        Tasks
      </h1>
      <p id="task-status" tabIndex={-1}>
        Status: For Review
      </p>
      {shown && (
        <TaskReview
          taskId={TASK_ID}
          canReview
          canReopen={false}
          taskTitle="Lay out the spread"
          focusTargetId="list-heading"
        />
      )}
    </main>
  )
}

const listHeading = () => document.getElementById("list-heading")!

const status = () => document.getElementById("task-status")!
const markDone = () => screen.getByRole("button", { name: "Mark done" })
const sendBackTrigger = () =>
  screen.getByRole("button", { name: "Send back with note" })
const reopen = () => screen.getByRole("button", { name: "Reopen" })
const noteInput = () => screen.getByLabelText("Note")

// An action call that stays pending until the test settles it.
function pendingCall(action: ReturnType<typeof vi.fn>) {
  let settle: (value: unknown) => void = () => {}
  action.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

describe("TaskReview", () => {
  it("shows nothing when task_capabilities offers neither review nor reopen", () => {
    const { container } = render(
      <TaskReview
        taskId={TASK_ID}
        canReview={false}
        canReopen={false}
        focusTargetId="task-status"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("offers Mark done (primary) and Send back with note (outline) when canReview", () => {
    render(<Page canReview />)

    expect(markDone()).toHaveAttribute("data-variant", "default")
    expect(markDone()).toHaveClass("min-h-11")
    expect(sendBackTrigger()).toHaveAttribute("data-variant", "outline")
    expect(sendBackTrigger()).toHaveClass("min-h-11")
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull()
  })

  it("offers only Reopen (outline) when canReopen", () => {
    render(<Page canReopen />)

    expect(reopen()).toHaveAttribute("data-variant", "outline")
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Send back with note" })
    ).toBeNull()
  })

  it("marks the task done, then toasts and focuses the status", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    render(<Page canReview />)

    await user.click(markDone())

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    expect(markDoneAction).toHaveBeenCalledExactlyOnceWith({ taskId: TASK_ID })
    expect(status()).toHaveFocus()
  })

  it("still focuses the status after Mark done when focus has fallen to the page", async () => {
    const user = userEvent.setup()
    let settle: (value: unknown) => void = () => {}
    markDoneAction.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    render(<Page canReview />)

    await user.click(markDone())
    await waitFor(() =>
      expect(markDone()).toHaveAttribute("aria-disabled", "true")
    )
    markDone().blur()
    expect(document.activeElement).toBe(document.body)

    settle({ ok: true, data: { column: "done" } })

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    expect(status()).toHaveFocus()
  })

  it("leaves focus alone after Reopen when it has moved off the buttons", async () => {
    const user = userEvent.setup()
    let settle: (value: unknown) => void = () => {}
    reopenTaskAction.mockReturnValue(
      new Promise((resolve) => (settle = resolve))
    )
    render(<Page canReopen />)

    await user.click(reopen())
    await waitFor(() =>
      expect(reopen()).toHaveAttribute("aria-disabled", "true")
    )
    const elsewhere = document.createElement("button")
    document.body.append(elsewhere)
    elsewhere.focus()

    settle({ ok: true, data: { column: "doing" } })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reopened."))
    expect(elsewhere).toHaveFocus()
    elsewhere.remove()
  })

  it("reopens the task, then toasts and focuses the status", async () => {
    const user = userEvent.setup()
    reopenTaskAction.mockResolvedValue({ ok: true, data: { column: "doing" } })
    render(<Page canReopen />)

    await user.click(reopen())

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reopened."))
    expect(reopenTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK_ID,
    })
    expect(status()).toHaveFocus()
  })

  it("keeps the buttons focusable but inert while a command saves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(markDoneAction)
    render(<Page canReview />)

    await user.click(markDone())

    await waitFor(() =>
      expect(markDone()).toHaveAttribute("aria-disabled", "true")
    )
    expect(markDone()).toBeEnabled()
    expect(sendBackTrigger()).toHaveAttribute("aria-disabled", "true")

    await user.click(markDone())
    await user.click(sendBackTrigger())
    expect(markDoneAction).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).toBeNull()

    settle({ ok: true, data: { column: "done" } })
    await waitFor(() => expect(markDone()).not.toHaveAttribute("aria-disabled"))
  })

  it.each([
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["tasks.stale", STALE],
  ])(
    "toasts %s's copy and re-reads the page when Mark done is refused",
    async (code, copy) => {
      const user = userEvent.setup()
      markDoneAction.mockResolvedValue({ ok: false, code })
      render(<Page canReview />)

      await user.click(markDone())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).toHaveBeenCalledOnce()
      expect(toastSuccess).not.toHaveBeenCalled()
    }
  )

  it("moves focus to the status if a refresh after a refused command takes the buttons away", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<Page canReview />)

    await user.click(markDone())
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await waitFor(() => expect(markDone()).not.toHaveAttribute("aria-disabled"))
    expect(markDone()).toHaveFocus()

    // Another approver marked it done first: the refresh offers Reopen.
    rerender(<Page canReopen />)
    expect(status()).toHaveFocus()
  })

  it("opens the Send back dialog with focus in the note", async () => {
    const user = userEvent.setup()
    render(<Page canReview />)

    await user.click(sendBackTrigger())

    const dialog = screen.getByRole("dialog", { name: "Send back with note" })
    expect(dialog).toBeInTheDocument()
    expect(noteInput()).toHaveFocus()
    expect(noteInput()).toHaveAttribute("maxlength", "5000")
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Send back" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("shows the blank-note error inline and calls nothing when the note is blank", async () => {
    const user = userEvent.setup()
    render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "   ")
    await user.click(screen.getByRole("button", { name: "Send back" }))

    const error = screen.getByText("Add a note so they know what to fix.")
    expect(error).toHaveAttribute("role", "alert")
    expect(noteInput()).toHaveAttribute("aria-invalid", "true")
    expect(noteInput()).toHaveAccessibleDescription(
      "Add a note so they know what to fix."
    )
    expect(noteInput()).toHaveFocus()
    expect(sendBackTaskAction).not.toHaveBeenCalled()

    await user.type(noteInput(), "Fix")
    expect(
      screen.queryByText("Add a note so they know what to fix.")
    ).toBeNull()
  })

  it("sends the task back with the note, then toasts, closes and focuses the status", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({
      ok: true,
      data: { column: "doing" },
    })
    render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "  fix captions ")
    await user.click(screen.getByRole("button", { name: "Send back" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent back."))
    expect(sendBackTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK_ID,
      note: "  fix captions ",
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(status()).toHaveFocus())
  })

  it("keeps the dialog open with the note, toasts and re-reads the page when Send back is refused", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(noteInput()).toHaveValue("Fix the captions")
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("keeps the dialog and the note when a refresh takes the buttons away, and focuses the status once it closes", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())

    rerender(<Page canReopen />)
    expect(noteInput()).toHaveValue("Fix the captions")

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(status()).toHaveFocus())
  })

  it("makes the dialog's Send back inert once a refresh takes canReview away, keeping the note readable and Cancel working", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())

    // Another approver marked it done first.
    rerender(<Page canReopen />)
    const submit = screen.getByRole("button", { name: "Send back" })
    await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "true"))
    expect(noteInput()).toHaveValue("Fix the captions")
    expect(noteInput()).not.toHaveAttribute("readonly")

    await user.click(submit)
    expect(sendBackTaskAction).toHaveBeenCalledOnce()
    expect(toastError).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(
      screen.queryByText("Add a note so they know what to fix.")
    ).toBeNull()

    const cancel = screen.getByRole("button", { name: "Cancel" })
    expect(cancel).not.toHaveAttribute("aria-disabled")
    await user.click(cancel)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("closes the dialog and focuses the status when, after a saved Send back, the page re-renders with nothing to offer", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({
      ok: true,
      data: { column: "doing" },
    })
    const { container, rerender } = render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent back."))

    // What revalidation hands back: Doing, with neither review nor reopen.
    rerender(<Page />)

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(
      screen.queryByRole("button", { name: "Send back with note" })
    ).toBeNull()
    expect(container.querySelector("main")?.children).toHaveLength(1)
    await waitFor(() => expect(status()).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it("focuses the status too when the re-render with nothing to offer lands before the save resolves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(sendBackTaskAction)
    const { rerender } = render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(sendBackTaskAction).toHaveBeenCalledOnce())

    rerender(<Page />)
    settle({ ok: true, data: { column: "doing" } })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent back."))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(status()).toHaveFocus())
  })

  it("ignores Escape and Cancel while Send back saves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(sendBackTaskAction)
    render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send back" })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
    )
    expect(noteInput()).toHaveAttribute("readonly")

    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(noteInput()).toHaveValue("Fix the captions")
    expect(sendBackTaskAction).toHaveBeenCalledOnce()

    settle({ ok: false, code: "tasks.save_failed" })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send back" })
      ).not.toHaveAttribute("aria-disabled")
    )
  })

  it("cancels, clears the note and returns focus to Send back with note", async () => {
    const user = userEvent.setup()
    render(<Page canReview />)

    await user.click(sendBackTrigger())
    await user.type(noteInput(), "Never mind")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(sendBackTrigger()).toHaveFocus())

    await user.click(sendBackTrigger())
    expect(noteInput()).toHaveValue("")
    expect(sendBackTaskAction).not.toHaveBeenCalled()
  })

  it("names Mark done and Send back with note for the task when given its title, keeping the visible text", () => {
    render(<ListPage />)

    const done = screen.getByRole("button", {
      name: "Mark done, Lay out the spread",
    })
    const trigger = screen.getByRole("button", {
      name: "Send back with note, Lay out the spread",
    })
    expect(done).toHaveTextContent(/^Mark done$/)
    expect(trigger).toHaveTextContent(/^Send back with note$/)
  })

  it("leaves the buttons named by their text without a title", () => {
    render(<Page canReview />)

    expect(markDone()).not.toHaveAttribute("aria-label")
    expect(sendBackTrigger()).not.toHaveAttribute("aria-label")
  })

  it("focuses the given target, not the status, after Mark done", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    render(<ListPage />)

    await user.click(
      screen.getByRole("button", { name: "Mark done, Lay out the spread" })
    )

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked done.")
    )
    expect(listHeading()).toHaveFocus()
  })

  it("focuses the given target after Send back, once the dialog closes", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({
      ok: true,
      data: { column: "doing" },
    })
    render(<ListPage />)

    await user.click(
      screen.getByRole("button", {
        name: "Send back with note, Lay out the spread",
      })
    )
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent back."))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(listHeading()).toHaveFocus())
  })

  it("moves focus to the given target when the whole component goes away with focus on a button", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<ListPage />)

    await user.click(
      screen.getByRole("button", { name: "Mark done, Lay out the spread" })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mark done, Lay out the spread" })
      ).not.toHaveAttribute("aria-disabled")
    )

    // The refresh took the row away.
    rerender(<ListPage shown={false} />)
    expect(listHeading()).toHaveFocus()
  })

  it("drops the dialog and its note, focusing the given target, when a refresh takes the whole component away", async () => {
    const user = userEvent.setup()
    sendBackTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const { rerender } = render(<ListPage />)

    await user.click(
      screen.getByRole("button", {
        name: "Send back with note, Lay out the spread",
      })
    )
    await user.type(noteInput(), "Fix the captions")
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))

    rerender(<ListPage shown={false} />)

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByText("Fix the captions")).toBeNull()
    await waitFor(() => expect(listHeading()).toHaveFocus())
  })

  it("has no axe violations, with the buttons and with the dialog open", async () => {
    const user = userEvent.setup()
    const { container } = render(<Page canReview />)
    expect(await axeViolations(container)).toEqual([])

    await user.click(sendBackTrigger())
    await user.click(screen.getByRole("button", { name: "Send back" }))
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([])
  })
})
