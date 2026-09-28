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
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberShell } from "./member-shell"

// The shell renders no data. Stub the modules that would read the session or
// the environment when the members slice loads. vi.mock factories run before
// this file's imports, so the action mock the tests inspect is vi.hoisted.
const { signOutAction } = vi.hoisted(() => ({ signOutAction: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signOutAction,
}))

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function renderShell() {
  return render(
    <MemberShell member={{ name: "Head Layout Artist" }}>
      <h1>What&apos;s mine</h1>
    </MemberShell>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MemberShell", () => {
  it("has no axe violations with the menu closed", async () => {
    const { container } = renderShell()
    expect(await axeViolations(container)).toEqual([])
  })

  it("has a banner with the logo, the wordmark and the account menu, then main", () => {
    renderShell()
    const banner = screen.getByRole("banner")

    expect(
      within(banner).getByRole("link", { name: "The Pillar" })
    ).toHaveAttribute("href", "/dashboard")
    expect(banner).toHaveClass("bg-navy", "border-b-3", "border-brand-gold")
    expect(banner.querySelector("img")).toHaveAttribute("alt", "")
    expect(
      within(banner).getByRole("button", {
        name: "Head Layout Artist, account",
      })
    ).toHaveClass("size-11")
    expect(screen.getByRole("main")).toHaveTextContent("What's mine")
  })

  it("opens the menu with Enter, offers Sign out, and returns focus on Escape", async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole("button", {
      name: "Head Layout Artist, account",
    })

    trigger.focus()
    await user.keyboard("{Enter}")

    const menu = await screen.findByRole("menu")
    expect(within(menu).getByText("Head Layout Artist")).toBeInTheDocument()
    const signOut = within(menu).getByRole("menuitem", { name: "Sign out" })
    expect(signOut).toHaveAttribute("type", "submit")
    expect(signOut.closest("form")).not.toBeNull()
    // A whole-page run would flag the portal outside the landmarks, so the
    // open state is checked on the menu itself.
    expect(await axeViolations(menu)).toEqual([])

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("submits the sign-out form when Sign out is clicked", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(
      screen.getByRole("button", { name: "Head Layout Artist, account" })
    )
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Sign out",
      })
    )

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce())
  })
})
