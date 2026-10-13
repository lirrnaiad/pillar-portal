// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountStateNotice } from "./account-state-notice"

const { signOutAction } = vi.hoisted(() => ({ signOutAction: vi.fn() }))

vi.mock("../actions", () => ({ signOutAction }))

const NEXT = "/dashboard/tasks/abc?view=board"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AccountStateNotice", () => {
  it.each([
    [
      "pending",
      "Awaiting approval",
      "You're signed in — a Board member will approve you shortly. Tell your editor or head you've joined.",
    ],
    [
      "declined",
      "Access declined",
      "Your access request wasn't approved. If this is a mistake, ask your editor or head.",
    ],
    [
      "deactivated",
      "No access",
      "Your access to the portal has ended. If this is a mistake, ask your editor or head.",
    ],
  ] as const)(
    "shows a %s member their state, and Sign out signs them out keeping next",
    async (state, title, text) => {
      const user = userEvent.setup()
      const { container } = render(
        <main>
          <AccountStateNotice state={state} next={NEXT} />
        </main>
      )

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title)
      expect(screen.getByText(text)).toBeInTheDocument()
      const signOut = screen.getByRole("button", { name: "Sign out" })
      const field = signOut.closest("form")?.querySelector('input[name="next"]')
      expect(field).toHaveAttribute("type", "hidden")
      expect(field).toHaveValue(NEXT)
      expect(
        (
          await axe.run(container, {
            rules: { "color-contrast": { enabled: false } },
          })
        ).violations
      ).toEqual([])

      await user.click(signOut)

      await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce())
      const formData = signOutAction.mock.calls[0][0] as FormData
      expect(formData.get("next")).toBe(NEXT)
    }
  )
})
