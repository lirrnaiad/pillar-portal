// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CopyLinkButton } from "./copy-link-button"

const URL_TO_COPY =
  "https://pillar.example/login?next=%2Fdashboard%2Ftasks%2Fabc"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations() {
  const { violations } = await axe.run(document.body, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  })
  return violations
}

function renderButton() {
  render(<CopyLinkButton url={URL_TO_COPY} />)
  return screen.getByRole("button", { name: "Copy link" })
}

describe("CopyLinkButton", () => {
  it("copies the link and announces it in a polite live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // userEvent.setup() installs its own clipboard, so the stub comes after.
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const button = renderButton()

    await user.click(button)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL_TO_COPY)
    const status = await screen.findByText(
      "Link copied — open Safari and paste it."
    )
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(await axeViolations()).toEqual([])
  })

  it("keeps the live region in the DOM, empty, before any copy", () => {
    const { container } = render(<CopyLinkButton url={URL_TO_COPY} />)

    const region = container.querySelector('[aria-live="polite"]')
    expect(region).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
  })

  it.each([
    ["no clipboard", {}],
    [
      "a refused write",
      { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } },
    ],
  ])(
    "shows the link in a read-only field, focused and selected, on %s",
    async (_label, nav) => {
      const user = userEvent.setup({ writeToClipboard: false })
      vi.stubGlobal("navigator", nav)
      const button = renderButton()

      await user.click(button)

      const field = screen.getByRole("textbox", { name: "Link to copy" })
      expect(field).toHaveValue(URL_TO_COPY)
      expect(field).toHaveAttribute("readonly")
      await waitFor(() => expect(field).toHaveFocus())
      const input = field as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(URL_TO_COPY.length)
      expect(
        screen.queryByText("Link copied — open Safari and paste it.")
      ).not.toBeInTheDocument()
      expect(await axeViolations()).toEqual([])
    }
  )

  it("hides the field and returns focus to the button once a later copy works", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("no"))
      .mockResolvedValueOnce(undefined)
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const button = renderButton()

    await user.click(button)
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Link to copy" })
      ).toHaveFocus()
    )
    await user.click(button)

    expect(
      await screen.findByText("Link copied — open Safari and paste it.")
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })
})
