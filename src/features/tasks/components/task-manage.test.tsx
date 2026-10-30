// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskManage } from "./task-manage"

const { deleteTaskAction, replace, refresh, toastError, toastSuccess } =
  vi.hoisted(() => ({
    deleteTaskAction: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  }))

vi.mock("../actions", () => ({ deleteTaskAction }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

const TASK_ID = "00000000-0000-4000-8000-000000000021"
// As PostgREST returns it, microseconds included.
const VERSION = "2026-10-30T02:15:42.123456+00:00"
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

// Task detail's status (TaskColumnControl's), where focus goes if the row
// goes away with focus on it.
function Page({ canManage = true }: { canManage?: boolean }) {
  return (
    <main>
      <p id="task-status" tabIndex={-1}>
        Status: Doing
      </p>
      <TaskManage
        taskId={TASK_ID}
        taskTitle="Lay out the spread"
        expectedUpdatedAt={VERSION}
        canManage={canManage}
        focusTargetId="task-status"
      />
    </main>
  )
}

const status = () => document.getElementById("task-status")!
const trigger = () => screen.getByRole("button", { name: "Delete" })
const dialog = () => screen.getByRole("alertdialog")
const confirm = () =>
  screen
    .getAllByRole("button", { name: "Delete" })
    .find((button) => dialog().contains(button))!
const cancel = () => screen.getByRole("button", { name: "Cancel" })

// An action call that stays pending until the test settles it.
function pendingCall() {
  let settle: (value: unknown) => void = () => {}
  deleteTaskAction.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

describe("TaskManage", () => {
  it("shows nothing when task_capabilities doesn't offer canManage", () => {
    const { container } = render(
      <TaskManage
        taskId={TASK_ID}
        taskTitle="Lay out the spread"
        expectedUpdatedAt={VERSION}
        canManage={false}
        focusTargetId="task-status"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("offers Delete (outline) when canManage", () => {
    render(<Page />)

    expect(trigger()).toHaveAttribute("data-variant", "outline")
    expect(trigger()).toHaveClass("min-h-11")
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("asks first, naming the task, with Cancel focused", async () => {
    const user = userEvent.setup()
    render(<Page />)

    await user.click(trigger())

    expect(dialog()).toHaveAccessibleName('Delete "Lay out the spread"?')
    expect(dialog()).toHaveAccessibleDescription(
      "Everyone loses access to it, and this can't be undone."
    )
    expect(cancel()).toHaveFocus()
    expect(confirm()).toHaveAttribute("data-variant", "destructive")
    expect(confirm()).toHaveClass("min-h-11")
    expect(cancel()).toHaveClass("min-h-11")
    expect(deleteTaskAction).not.toHaveBeenCalled()
  })

  it("cancels without calling anything and returns focus to Delete", async () => {
    const user = userEvent.setup()
    render(<Page />)

    await user.click(trigger())
    await user.click(cancel())

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(trigger()).toHaveFocus())
    expect(deleteTaskAction).not.toHaveBeenCalled()
  })

  it("deletes with the version it was rendered from, untouched, then replaces the page with /admin/tasks and the notice", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockResolvedValue({ ok: true, data: { taskId: TASK_ID } })
    render(<Page />)

    await user.click(trigger())
    await user.click(confirm())

    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/admin/tasks?notice=task-deleted"
      )
    )
    expect(deleteTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK_ID,
      expectedUpdatedAt: VERSION,
    })
    // The toast is /admin/tasks' notice, not this component's.
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("keeps the dialog open and inert while the delete saves, and while the page leaves after it", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    render(<Page />)

    await user.click(trigger())
    await user.click(confirm())

    await waitFor(() =>
      expect(confirm()).toHaveAttribute("aria-disabled", "true")
    )
    expect(cancel()).toHaveAttribute("aria-disabled", "true")
    expect(confirm()).toBeEnabled()

    await user.keyboard("{Escape}")
    await user.click(cancel())
    await user.click(confirm())
    expect(dialog()).toBeInTheDocument()
    expect(deleteTaskAction).toHaveBeenCalledOnce()

    settle({ ok: true, data: { taskId: TASK_ID } })
    await waitFor(() => expect(replace).toHaveBeenCalledOnce())

    await user.keyboard("{Escape}")
    await user.click(confirm())
    expect(dialog()).toBeInTheDocument()
    expect(confirm()).toHaveAttribute("aria-disabled", "true")
    expect(deleteTaskAction).toHaveBeenCalledOnce()
  })

  it("shows the stale line, closes the dialog and re-reads the page when the task changed since it loaded", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    render(<Page />)

    await user.click(trigger())
    await user.click(confirm())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(trigger()).toHaveFocus())
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    ["tasks.not_found", "This task was deleted or the link is wrong."],
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["tasks.save_failed", "Couldn't save — try again."],
  ])(
    "toasts %s's copy, re-reads the page and closes the dialog when the delete is refused",
    async (code, copy) => {
      const user = userEvent.setup()
      deleteTaskAction.mockResolvedValue({ ok: false, code })
      render(<Page />)

      await user.click(trigger())
      await user.click(confirm())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).toHaveBeenCalledOnce()
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(replace).not.toHaveBeenCalled()
    }
  )

  it("toasts the generic copy when the call itself fails", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockRejectedValue(new Error("network"))
    render(<Page />)

    await user.click(trigger())
    await user.click(confirm())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("moves focus to the status if a refresh after a refused delete takes the row away", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_approver",
    })
    const { rerender } = render(<Page />)

    await user.click(trigger())
    await user.click(confirm())
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await waitFor(() => expect(trigger()).toHaveFocus())

    // The refresh shows the caller is no longer the approver.
    rerender(<Page canManage={false} />)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(status()).toHaveFocus()
  })

  it("keeps the open dialog when a refresh takes Delete away, and focuses the status once it closes", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page />)

    await user.click(trigger())

    // Another approver's change took the caller's manage rights away.
    rerender(<Page canManage={false} />)
    expect(dialog()).toHaveAccessibleName('Delete "Lay out the spread"?')

    await user.click(cancel())
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    await waitFor(() => expect(status()).toHaveFocus())
    expect(deleteTaskAction).not.toHaveBeenCalled()
  })

  it("has no axe violations, with Delete and with the dialog open", async () => {
    const user = userEvent.setup()
    const { container } = render(<Page />)
    expect(await axeViolations(container)).toEqual([])

    await user.click(trigger())
    expect(await axeViolations(dialog())).toEqual([])
  })
})
