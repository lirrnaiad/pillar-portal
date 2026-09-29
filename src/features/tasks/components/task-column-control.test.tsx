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

import { TaskColumnControl } from "./task-column-control"

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

const TASK_ID = "00000000-0000-4000-8000-000000000021"

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

const trigger = () => screen.getByRole("combobox", { name: "Move to…" })

// The column's status: a polite live region holding "Status: <label>".
function status(container: HTMLElement) {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]')
  if (!region) throw new Error("no live status region")
  return region
}

async function chooseMove(
  user: ReturnType<typeof userEvent.setup>,
  optionName: string
) {
  await user.click(trigger())
  await user.click(await screen.findByRole("option", { name: optionName }))
}

// An action call that stays pending until the test settles it.
function pendingCall() {
  let settle: (value: unknown) => void = () => {}
  moveTaskAction.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

describe("TaskColumnControl", () => {
  it.each([
    ["to_do", "To Do", "neutral"],
    ["doing", "Doing", "progress"],
    ["for_review", "For Review", "progress"],
    ["done", "Done", "positive"],
  ] as const)("shows %s as %j beside a %s dot", (column, label, family) => {
    const { container } = render(
      <TaskColumnControl taskId={TASK_ID} column={column} allowedMoves={[]} />
    )

    expect(status(container)).toHaveTextContent(`Status: ${label}`)
    const dots = status(container).querySelectorAll("[data-family]")
    expect(dots).toHaveLength(1)
    expect(dots[0]).toHaveAttribute("data-family", family)
    expect(dots[0]).toHaveClass(`bg-status-${family}`)
  })

  it("puts the status in a polite, atomic live region the page can focus", () => {
    const { container } = render(
      <TaskColumnControl taskId={TASK_ID} column="to_do" allowedMoves={[]} />
    )

    const region = status(container)
    expect(region).toHaveAttribute("aria-atomic", "true")
    expect(region).toHaveAttribute("tabindex", "-1")
    expect(within(region).getByText("Status:")).toHaveClass("sr-only")
  })

  it("shows no move control when no move is allowed", () => {
    render(
      <TaskColumnControl taskId={TASK_ID} column="done" allowedMoves={[]} />
    )

    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("lists exactly the allowed moves, in the order given", async () => {
    const user = userEvent.setup()
    render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="doing"
        allowedMoves={["to_do", "for_review"]}
      />
    )

    expect(trigger()).toHaveClass("min-h-11")
    await user.click(trigger())
    const listbox = await screen.findByRole("listbox")

    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["To Do", "For Review"])
  })

  it("shows the new column in the live region at once, and keeps the select focusable but inert while the move saves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    const { container } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="to_do"
        allowedMoves={["doing", "for_review"]}
      />
    )

    await chooseMove(user, "For Review")

    expect(moveTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK_ID,
      toColumn: "for_review",
    })
    await waitFor(() =>
      expect(status(container)).toHaveTextContent("Status: For Review")
    )
    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-disabled", "true")
    )
    expect(trigger()).toBeEnabled()
    expect(trigger()).toHaveFocus()

    await user.click(trigger())
    expect(screen.queryByRole("listbox")).toBeNull()

    settle({ ok: true, data: { column: "for_review" } })
    await waitFor(() => expect(trigger()).not.toHaveAttribute("aria-disabled"))
    expect(moveTaskAction).toHaveBeenCalledOnce()
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("keeps focus on the select when moves remain after a move", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockResolvedValue({ ok: true, data: { column: "doing" } })
    const { rerender } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="to_do"
        allowedMoves={["doing"]}
      />
    )

    await chooseMove(user, "Doing")
    await waitFor(() => expect(trigger()).not.toHaveAttribute("aria-disabled"))
    // What revalidation hands back: the new column and its moves.
    rerender(
      <TaskColumnControl
        taskId={TASK_ID}
        column="doing"
        allowedMoves={["to_do", "for_review"]}
      />
    )

    expect(trigger()).toHaveFocus()
  })

  it("moves focus to the status when a move leaves no further moves", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    const { container, rerender } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="for_review"
        allowedMoves={["done"]}
      />
    )

    await chooseMove(user, "Done")
    await waitFor(() => expect(trigger()).not.toHaveAttribute("aria-disabled"))
    rerender(
      <TaskColumnControl taskId={TASK_ID} column="done" allowedMoves={[]} />
    )

    expect(screen.queryByRole("combobox")).toBeNull()
    await waitFor(() => expect(status(container)).toHaveFocus())
    expect(status(container)).toHaveTextContent("Status: Done")
  })

  it("leaves focus alone when the moves go away while focus is elsewhere", () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <TaskColumnControl
          taskId={TASK_ID}
          column="to_do"
          allowedMoves={["doing"]}
        />
      </>
    )
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" })
    elsewhere.focus()

    rerender(
      <>
        <button type="button">Elsewhere</button>
        <TaskColumnControl taskId={TASK_ID} column="doing" allowedMoves={[]} />
      </>
    )

    expect(elsewhere).toHaveFocus()
  })

  it("rolls the column back in the live region, toasts the error's copy, refreshes and keeps focus when the move is refused", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockResolvedValue({ ok: false, code: "tasks.not_allowed" })
    const { container } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="to_do"
        allowedMoves={["doing"]}
      />
    )

    await chooseMove(user, "Doing")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        "Couldn't save — try again."
      )
    )
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(status(container)).toHaveTextContent("Status: To Do")
    )
    expect(trigger()).toHaveFocus()
  })

  it("toasts 'Couldn't save — try again.', refreshes and keeps focus when the call itself fails", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockRejectedValue(new Error("network"))
    const { container } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="to_do"
        allowedMoves={["doing"]}
      />
    )

    await chooseMove(user, "Doing")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        "Couldn't save — try again."
      )
    )
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(status(container)).toHaveTextContent("Status: To Do")
    )
    expect(trigger()).toHaveFocus()
  })

  it("has no axe violations, with or without the move control", async () => {
    const { container, rerender } = render(
      <TaskColumnControl
        taskId={TASK_ID}
        column="to_do"
        allowedMoves={["doing"]}
      />
    )
    expect(await axeViolations(container)).toEqual([])

    rerender(
      <TaskColumnControl taskId={TASK_ID} column="done" allowedMoves={[]} />
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
