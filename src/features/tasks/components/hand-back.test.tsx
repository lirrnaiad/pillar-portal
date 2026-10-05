// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HandBack } from "./hand-back"

const { handBackSlotAction, refresh, toastError, toastSuccess } = vi.hoisted(
  () => ({
    handBackSlotAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
)

vi.mock("../actions", () => ({ handBackSlotAction }))
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

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function renderHandBack() {
  return render(
    <ul>
      <li id={ROW_ID} tabIndex={-1}>
        Layout Artist
        <HandBack slotId={SLOT_ID} slotLabel="Layout Artist" rowId={ROW_ID} />
      </li>
    </ul>
  )
}

const trigger = () => screen.getByRole("button", { name: /^Hand back/ })
const reasonInput = () => screen.getByLabelText("Reason (optional)")

describe("HandBack", () => {
  it("is a 44px secondary button that opens nothing until chosen", () => {
    renderHandBack()

    expect(trigger()).toHaveClass("min-h-11")
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()
  })

  it("opens the reason form with focus in the input, and has no axe violations", async () => {
    const user = userEvent.setup()
    const { container } = renderHandBack()

    await user.click(trigger())

    expect(reasonInput()).toHaveFocus()
    expect(trigger()).toHaveAttribute("aria-expanded", "true")
    expect(await axeViolations(container)).toEqual([])
  })

  it("hands the slot back with the reason, then toasts and focuses the row", async () => {
    const user = userEvent.setup()
    handBackSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "needs_reassignment" },
    })
    renderHandBack()

    await user.click(trigger())
    await user.type(reasonInput(), "Out sick")
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Handed back — your head will reassign it."
      )
    )
    expect(handBackSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT_ID,
      reason: "Out sick",
    })
    expect(document.getElementById(ROW_ID)).toHaveFocus()
  })

  it("hands back with Enter and no reason", async () => {
    const user = userEvent.setup()
    handBackSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "needs_reassignment" },
    })
    renderHandBack()

    await user.click(trigger())
    await user.keyboard("{Enter}")

    await waitFor(() => expect(handBackSlotAction).toHaveBeenCalled())
    expect(handBackSlotAction).toHaveBeenCalledWith({
      slotId: SLOT_ID,
      reason: "",
    })
  })

  it("cancels with Escape, clears the reason and returns focus to the button", async () => {
    const user = userEvent.setup()
    renderHandBack()

    await user.click(trigger())
    await user.type(reasonInput(), "Nope")
    await user.keyboard("{Escape}")

    expect(screen.queryByLabelText("Reason (optional)")).toBeNull()
    expect(trigger()).toHaveFocus()
    expect(handBackSlotAction).not.toHaveBeenCalled()
  })

  it("toasts the error copy and re-reads the page when the hand-back is refused", async () => {
    const user = userEvent.setup()
    handBackSlotAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_allowed",
    })
    renderHandBack()

    await user.click(trigger())
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it("toasts the generic copy when the call throws", async () => {
    const user = userEvent.setup()
    handBackSlotAction.mockRejectedValue(new Error("network"))
    renderHandBack()

    await user.click(trigger())
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
  })
})
