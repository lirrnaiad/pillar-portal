// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { createPortal } from "react-dom"
import { afterEach, describe, expect, it } from "vitest"

import { isInPopupOf, isOnPage, useFocusFallback } from "./use-focus-fallback"

afterEach(() => {
  cleanup()
})

const TARGET_ID = "focus-fallback-target"

// A component using the hook: a button inside its root and, when `popup` is
// given, a portaled popup (outside the root) marked as owned by `popup`.
function Panel({
  popupOwnerId,
  popup,
}: {
  popupOwnerId?: string
  popup?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useFocusFallback(rootRef, TARGET_ID, popupOwnerId)
  return (
    <div ref={rootRef}>
      <button type="button">Inside</button>
      {popup !== undefined &&
        createPortal(
          <div data-popup-owner={popup}>
            <button type="button">In popup</button>
          </div>,
          document.body
        )}
    </div>
  )
}

function Page({
  show,
  popupOwnerId,
  popup,
}: {
  show: boolean
  popupOwnerId?: string
  popup?: string
}) {
  return (
    <>
      <h2 id={TARGET_ID} tabIndex={-1}>
        Target
      </h2>
      <button type="button">Elsewhere</button>
      {show && <Panel popupOwnerId={popupOwnerId} popup={popup} />}
    </>
  )
}

const target = () => screen.getByRole("heading", { name: "Target" })
const button = (name: string) => screen.getByRole("button", { name })

// The popup path's move waits for a microtask.
const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe("useFocusFallback", () => {
  it("moves focus inside the root to the target when the component goes away", () => {
    const { rerender } = render(<Page show />)
    button("Inside").focus()

    rerender(<Page show={false} />)

    expect(target()).toHaveFocus()
  })

  it("leaves focus elsewhere where it is", async () => {
    const { rerender } = render(<Page show popupOwnerId="card" popup="card" />)
    button("Elsewhere").focus()

    rerender(<Page show={false} popupOwnerId="card" popup="card" />)
    await microtask()

    expect(button("Elsewhere")).toHaveFocus()
  })

  it("with a popup owner, moves focus in its popup to the target once the popup has gone", async () => {
    const { rerender } = render(<Page show popupOwnerId="card" popup="card" />)
    button("In popup").focus()

    rerender(<Page show={false} popupOwnerId="card" popup="card" />)
    await microtask()

    expect(target()).toHaveFocus()
  })

  it("with a popup owner, leaves focus that has moved on before the microtask", async () => {
    const { rerender } = render(<Page show popupOwnerId="card" popup="card" />)
    button("In popup").focus()

    rerender(<Page show={false} popupOwnerId="card" popup="card" />)
    button("Elsewhere").focus()
    await microtask()

    expect(button("Elsewhere")).toHaveFocus()
  })

  it("without a popup owner, leaves focus in a popup alone", async () => {
    const { rerender } = render(<Page show popup="card" />)
    button("In popup").focus()

    rerender(<Page show={false} popup="card" />)
    await microtask()

    expect(target()).not.toHaveFocus()
  })

  it("ignores a popup another component owns", async () => {
    const { rerender } = render(<Page show popupOwnerId="card" popup="other" />)
    button("In popup").focus()

    rerender(<Page show={false} popupOwnerId="card" popup="other" />)
    await microtask()

    expect(target()).not.toHaveFocus()
  })
})

describe("isInPopupOf", () => {
  it("matches an element inside a popup its owner marked, and no other", () => {
    render(
      <>
        <div data-popup-owner="card">
          <button type="button">Owned</button>
        </div>
        <div data-popup-owner="other">
          <button type="button">Not owned</button>
        </div>
        <button type="button">Outside</button>
      </>
    )

    expect(isInPopupOf(button("Owned"), "card")).toBe(true)
    expect(isInPopupOf(button("Not owned"), "card")).toBe(false)
    expect(isInPopupOf(button("Outside"), "card")).toBe(false)
    expect(isInPopupOf(null, "card")).toBe(false)
  })
})

describe("isOnPage", () => {
  it("is true for nothing or the body, false for any other element", () => {
    expect(isOnPage(null)).toBe(true)
    expect(isOnPage(document.body)).toBe(true)
    expect(isOnPage(document.createElement("button"))).toBe(false)
  })
})
