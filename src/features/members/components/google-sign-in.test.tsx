// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GoogleSignIn } from "./google-sign-in"

const { signInWithGoogleAction } = vi.hoisted(() => ({
  signInWithGoogleAction: vi.fn(),
}))

vi.mock("../actions", () => ({ signInWithGoogleAction }))

const NEXT = "/dashboard/tasks/abc"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderOnPage() {
  // The login page puts the form inside <main>, which axe's region rule
  // expects of all content.
  return render(
    <main>
      <GoogleSignIn next={NEXT} />
    </main>
  )
}

describe("GoogleSignIn", () => {
  it("is one full-width submit button with the Google mark, posting next", async () => {
    const { container } = renderOnPage()
    const button = screen.getByRole("button", { name: "Sign in with Google" })

    expect(button).toHaveAttribute("type", "submit")
    expect(button).toHaveClass("min-h-11", "w-full")
    const mark = button.querySelector("img")
    expect(mark).toHaveAttribute("src", "/google-g.svg")
    expect(mark).toHaveAttribute("alt", "")
    const field = container.querySelector('input[name="next"]')
    expect(field).toHaveAttribute("type", "hidden")
    expect(field).toHaveValue(NEXT)
    expect(field?.closest("form")).toBe(button.closest("form"))
    expect(
      (
        await axe.run(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations
    ).toEqual([])
  })

  it("sends next, then stays focusable but aria-disabled and ignores a second press while pending", async () => {
    let finish: () => void = () => {}
    signInWithGoogleAction.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const user = userEvent.setup()
    renderOnPage()
    const button = screen.getByRole("button", { name: "Sign in with Google" })

    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"))
    expect(button).not.toBeDisabled()
    await user.click(button)

    expect(signInWithGoogleAction).toHaveBeenCalledOnce()
    const formData = signInWithGoogleAction.mock.calls[0][0] as FormData
    expect(formData.get("next")).toBe(NEXT)

    await act(async () => finish())
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"))
  })
})
