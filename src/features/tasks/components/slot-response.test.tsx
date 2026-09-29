// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SlotResponse } from "./slot-response"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { respondToSlotAction, refresh, toastError, toastSuccess } = vi.hoisted(
  () => ({
    respondToSlotAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
)

vi.mock("../actions", () => ({ respondToSlotAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

const SLOT_ID = "00000000-0000-4000-8000-000000000031"
const ROW_ID = `slot-${SLOT_ID}`

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

// The slot's row, as TaskDetailView renders it: the focus target once the
// answer is saved and SlotResponse goes away (`respondable: false`, as after
// revalidation).
function SlotRow({ respondable = true }: { respondable?: boolean }) {
  return (
    <ul>
      <li id={ROW_ID} tabIndex={-1}>
        Layout Artist · Staff Layout Artist
        {respondable && (
          <SlotResponse
            slotId={SLOT_ID}
            slotLabel="Layout Artist"
            rowId={ROW_ID}
          />
        )}
      </li>
    </ul>
  )
}

function renderResponse() {
  return render(<SlotRow />)
}

// An action call that stays pending until the test settles it.
function pendingCall() {
  let settle: (value: unknown) => void = () => {}
  respondToSlotAction.mockReturnValue(
    new Promise((resolve) => (settle = resolve))
  )
  return (value: unknown) => settle(value)
}

const row = () => document.getElementById(ROW_ID)
const onIt = () => screen.getByRole("button", { name: /^I'm on it/ })
const cantTake = () => screen.getByRole("button", { name: /^Can't take this/ })
const reasonInput = () => screen.getByLabelText("Reason (optional)")

describe("SlotResponse", () => {
  it("offers I'm on it and Can't take this as two equal 44px outline buttons, named for the slot", () => {
    renderResponse()

    for (const button of [onIt(), cantTake()]) {
      expect(button).toHaveAttribute("data-variant", "outline")
      expect(button).toHaveClass("min-h-11")
    }
    expect(onIt()).toHaveAccessibleName(/Layout Artist/)
    expect(cantTake()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()
  })

  it("answers I'm on it, with no reason, and toasts", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "on_it" },
    })
    renderResponse()

    await user.click(onIt())

    expect(respondToSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT_ID,
      response: "on_it",
      reason: null,
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith("You're on it.")
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it("keeps the buttons focusable but inert while the answer is saving", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    renderResponse()

    await user.click(onIt())

    await waitFor(() => expect(onIt()).toHaveAttribute("aria-disabled", "true"))
    expect(cantTake()).toHaveAttribute("aria-disabled", "true")
    expect(onIt()).toBeEnabled()
    expect(onIt()).toHaveFocus()

    await user.click(onIt())
    await user.click(cantTake())
    expect(respondToSlotAction).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()

    settle({ ok: true, data: { state: "on_it" } })
    await waitFor(() => expect(onIt()).not.toHaveAttribute("aria-disabled"))
  })

  it("moves focus to the slot's row once the answer is saved, and keeps it there when the buttons go away", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "on_it" },
    })
    const { rerender } = renderResponse()

    await user.click(onIt())

    await waitFor(() => expect(row()).toHaveFocus())
    rerender(<SlotRow respondable={false} />)
    expect(row()).toHaveFocus()
  })

  it("keeps focus where it was when the answer is refused", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_allowed",
    })
    renderResponse()

    await user.click(onIt())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        "Couldn't save — try again."
      )
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(toastSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(onIt()).not.toHaveAttribute("aria-disabled"))
    expect(onIt()).toHaveFocus()
  })

  it("moves focus to the slot's row if a refresh after a refused answer takes the buttons away", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_allowed",
    })
    const { rerender } = renderResponse()

    await user.click(onIt())
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(onIt()).toHaveFocus()

    rerender(<SlotRow respondable={false} />)
    expect(row()).toHaveFocus()
  })

  it("toasts 'Couldn't save — try again.' and refreshes when the call itself fails", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockRejectedValue(new Error("network"))
    renderResponse()

    await user.click(cantTake())
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        "Couldn't save — try again."
      )
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Hand it back" })).toHaveFocus()
  })

  it("opens the hand-back form on Can't take this, focused on the reason", async () => {
    const user = userEvent.setup()
    renderResponse()

    await user.click(cantTake())

    expect(cantTake()).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByText(
        "Can't take this? Hand it back — your head will reassign it."
      )
    ).toBeInTheDocument()
    expect(reasonInput()).toHaveAttribute("maxLength", "280")
    expect(reasonInput()).toHaveAccessibleDescription(
      "Only you and the task's approver see this."
    )
    await waitFor(() => expect(reasonInput()).toHaveFocus())
    expect(reasonInput().closest("form")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Hand it back" })
    ).toHaveAttribute("type", "submit")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "type",
      "button"
    )
  })

  it("focuses the reason again when Can't take this is pressed with the form already open", async () => {
    const user = userEvent.setup()
    renderResponse()

    await user.click(cantTake())
    await waitFor(() => expect(reasonInput()).toHaveFocus())
    await user.click(cantTake())

    expect(reasonInput()).toHaveFocus()
  })

  it("hands the slot back with the reason typed, and toasts", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "needs_reassignment" },
    })
    renderResponse()

    await user.click(cantTake())
    await user.type(reasonInput(), "Exams all week")
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    expect(respondToSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "Exams all week",
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
        "Handed back — your head will reassign it."
      )
    )
    expect(row()).toHaveFocus()
  })

  it("hands the slot back on Enter in the reason field", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "needs_reassignment" },
    })
    renderResponse()

    await user.click(cantTake())
    await user.type(reasonInput(), "Exams all week{Enter}")

    expect(respondToSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "Exams all week",
    })
  })

  it("keeps the reason field focusable but read-only, and ignores Enter, while the hand-back is saving", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    renderResponse()

    await user.click(cantTake())
    await user.type(reasonInput(), "Busy{Enter}")

    await waitFor(() =>
      expect(reasonInput()).toHaveAttribute("aria-disabled", "true")
    )
    expect(reasonInput()).toHaveAttribute("readonly")
    expect(reasonInput()).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(respondToSlotAction).toHaveBeenCalledOnce()

    settle({ ok: false, code: "tasks.save_failed" })
    await waitFor(() => expect(reasonInput()).not.toHaveAttribute("readonly"))
    expect(reasonInput()).toHaveFocus()
  })

  it("closes the form on Cancel, clearing the reason and returning focus", async () => {
    const user = userEvent.setup()
    renderResponse()

    await user.click(cantTake())
    await user.type(reasonInput(), "Busy")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()
    expect(cantTake()).toHaveFocus()
    expect(respondToSlotAction).not.toHaveBeenCalled()

    await user.click(cantTake())
    expect(reasonInput()).toHaveValue("")
  })

  it("closes the form on Escape, like Cancel", async () => {
    const user = userEvent.setup()
    renderResponse()

    await user.click(cantTake())
    await user.type(reasonInput(), "Busy")
    await user.keyboard("{Escape}")

    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()
    expect(cantTake()).toHaveAttribute("aria-expanded", "false")
    expect(cantTake()).toHaveFocus()
    expect(respondToSlotAction).not.toHaveBeenCalled()
  })

  it("has no axe violations, closed or open", async () => {
    const user = userEvent.setup()
    const { container } = renderResponse()
    expect(await axeViolations(container)).toEqual([])

    await user.click(cantTake())
    expect(await axeViolations(container)).toEqual([])
  })
})
