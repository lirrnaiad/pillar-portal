// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MoveToSelect } from "./move-to-select"

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

const trigger = () => screen.getByRole("combobox", { name: "Move to…" })

describe("MoveToSelect", () => {
  it("moves only through a chosen option", async () => {
    const onMove = vi.fn()
    const user = userEvent.setup()
    render(
      <MoveToSelect
        allowedMoves={["doing", "for_review"]}
        pending={false}
        onMove={onMove}
      />
    )

    await user.click(trigger())
    await user.click(await screen.findByRole("option", { name: "Doing" }))

    expect(onMove).toHaveBeenCalledExactlyOnceWith("doing")
  })

  // Radix selects the matching item when a letter is typed on a closed
  // trigger. A move is a command, so a stray letter must not make one.
  it("never moves on a letter typed on the closed trigger", async () => {
    const onMove = vi.fn()
    const user = userEvent.setup()
    render(
      <MoveToSelect
        allowedMoves={["doing", "for_review"]}
        pending={false}
        onMove={onMove}
      />
    )

    trigger().focus()
    await user.keyboard("d")
    await user.keyboard("f")

    expect(onMove).not.toHaveBeenCalled()
    expect(trigger()).toHaveTextContent("Move to…")
  })

  it("still opens from the keyboard", async () => {
    const user = userEvent.setup()
    render(
      <MoveToSelect allowedMoves={["doing"]} pending={false} onMove={vi.fn()} />
    )

    trigger().focus()
    await user.keyboard("{Enter}")

    expect(
      await screen.findByRole("option", { name: "Doing" })
    ).toBeInTheDocument()
  })

  it("ignores a value change while pending, and won't open", async () => {
    const onMove = vi.fn()
    const user = userEvent.setup()
    render(
      <MoveToSelect allowedMoves={["doing"]} pending={true} onMove={onMove} />
    )

    expect(trigger()).toHaveAttribute("aria-disabled", "true")
    await user.click(trigger())
    expect(screen.queryByRole("option")).not.toBeInTheDocument()

    trigger().focus()
    await user.keyboard("d")
    expect(onMove).not.toHaveBeenCalled()
  })
})
