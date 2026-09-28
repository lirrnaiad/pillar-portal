// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminShell } from "./admin-shell"

// The shell renders no data of its own. Stub the modules the members slice
// would otherwise load (mirrors src/app/(member)/member-shell.test.tsx).
const { signOutAction, usePathname } = vi.hoisted(() => ({
  signOutAction: vi.fn(),
  usePathname: vi.fn(() => "/admin/tasks"),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signOutAction,
}))
vi.mock("next/navigation", () => ({ usePathname }))

// jsdom has no PointerEvent capture support, which Radix's Sheet (a Dialog)
// relies on.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function renderShell() {
  return render(
    <AdminShell member={{ name: "Head Layout Artist" }}>
      <h1>Create a task</h1>
    </AdminShell>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  usePathname.mockReturnValue("/admin/tasks")
})

describe("AdminShell", () => {
  it("has no axe violations", async () => {
    const { container } = renderShell()
    expect(await axeViolations(container)).toEqual([])
  })

  it("widens the header past the member shell's 640px cap, up to 1440px", () => {
    renderShell()
    const banner = screen.getByRole("banner")
    expect(banner.querySelector(".max-w-\\[1440px\\]")).not.toBeNull()
  })

  it("renders Tasks in the sidebar nav, current when on /admin/tasks", () => {
    renderShell()
    const nav = screen.getByRole("navigation", { name: "Admin" })
    const link = within(nav).getByRole("link", { name: "Tasks" })

    expect(link).toHaveAttribute("href", "/admin/tasks")
    expect(link).toHaveAttribute("aria-current", "page")
  })

  it("offers My dashboard and Sign out in the avatar menu", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(
      screen.getByRole("button", { name: "Head Layout Artist, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(
      within(menu).getByRole("menuitem", { name: "My dashboard" })
    ).toHaveAttribute("href", "/dashboard")
    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce())
  })

  it("opens the nav in a Sheet from the header's menu button (the mobile/tablet path)", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("button", { name: "Open admin menu" }))
    const dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/admin/tasks"
    )
  })

  it("renders the page content in main", () => {
    renderShell()
    expect(screen.getByRole("main")).toHaveTextContent("Create a task")
  })
})
