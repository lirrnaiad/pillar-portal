// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PersonaSignIn } from "./persona-sign-in"

const { signInAsPersonaAction } = vi.hoisted(() => ({
  signInAsPersonaAction: vi.fn(),
}))

vi.mock("../actions", () => ({ signInAsPersonaAction }))

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const NEXT = "/dashboard?view=board"

function renderOnPage() {
  // The login page puts the form inside <main>, which axe's region rule
  // expects of all content.
  return render(
    <main>
      <PersonaSignIn next={NEXT} />
    </main>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("PersonaSignIn", () => {
  it("has no axe violations", async () => {
    const { container } = renderOnPage()
    expect(await axeViolations(container)).toEqual([])
  })

  it("renders one full-width submit button per persona, all in one form", () => {
    renderOnPage()
    const buttons = screen.getAllByRole("button")

    expect(buttons.map((button) => button.textContent)).toEqual([
      "Staff Layout Artist",
      "Head Layout Artist",
      "Editor-in-Chief",
    ])
    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "submit")
      expect(button).toHaveAttribute("name", "persona")
      expect(button).toHaveClass("w-full", "min-h-11")
      expect(button.closest("form")).toBe(buttons[0].closest("form"))
    }
    expect(buttons.map((button) => button.getAttribute("value"))).toEqual([
      "staff_layout_artist",
      "head_layout_artist",
      "editor_in_chief",
    ])
  })

  it("carries next in a hidden field of the same form", () => {
    const { container } = renderOnPage()
    const field = container.querySelector('input[name="next"]')

    expect(field).toHaveAttribute("type", "hidden")
    expect(field).toHaveValue(NEXT)
    expect(field?.closest("form")).toBe(
      screen.getAllByRole("button")[0].closest("form")
    )
  })

  it("sends the pressed persona and announces a failure in a polite live region", async () => {
    signInAsPersonaAction.mockResolvedValue({
      ok: false,
      code: "auth.sign_in_failed",
    })
    const user = userEvent.setup()
    renderOnPage()

    await user.click(screen.getByRole("button", { name: "Head Layout Artist" }))

    const status = await screen.findByText("Sign-in didn't finish. Try again.")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(signInAsPersonaAction).toHaveBeenCalledOnce()
    const formData = signInAsPersonaAction.mock.calls[0][1] as FormData
    expect(formData.get("persona")).toBe("head_layout_artist")
    expect(formData.get("next")).toBe(NEXT)
  })

  it("announces a second identical failure again: the message leaves the live region while pending", async () => {
    const FAILED = { ok: false, code: "auth.sign_in_failed" } as const
    const MESSAGE = "Sign-in didn't finish. Try again."
    let finishSecond: (state: typeof FAILED) => void = () => {}
    signInAsPersonaAction
      .mockResolvedValueOnce(FAILED)
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishSecond = resolve))
      )
    const user = userEvent.setup()
    renderOnPage()

    await user.click(screen.getByRole("button", { name: "Editor-in-Chief" }))
    const region = await screen.findByText(MESSAGE)

    await user.click(screen.getByRole("button", { name: "Editor-in-Chief" }))
    // Pending: the region is still in the DOM, now empty.
    await waitFor(() => expect(region).toBeEmptyDOMElement())
    expect(region).toHaveAttribute("aria-live", "polite")

    await act(async () => finishSecond(FAILED))
    await waitFor(() => expect(region).toHaveTextContent(MESSAGE))
    expect(signInAsPersonaAction).toHaveBeenCalledTimes(2)
    // React resets the form after an action; next survives for the retry.
    const retry = signInAsPersonaAction.mock.calls[1][1] as FormData
    expect(retry.get("next")).toBe(NEXT)
  })
})
