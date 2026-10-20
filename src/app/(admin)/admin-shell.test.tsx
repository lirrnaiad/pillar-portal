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

// jsdom has no PointerEvent capture support, which Radix's DropdownMenu (the
// avatar menu) relies on.
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

  it("links the logo to Admin home", () => {
    renderShell()
    const banner = screen.getByRole("banner")
    expect(
      within(banner).getByRole("link", { name: "The Pillar" })
    ).toHaveAttribute("href", "/admin")
  })

  it("renders Home, Tasks then Members in the sidebar nav, Tasks current on /admin/tasks", () => {
    renderShell()
    const nav = screen.getByRole("navigation", { name: "Admin" })
    const links = within(nav).getAllByRole("link")

    expect(nav.closest("aside")).toHaveClass("hidden", "lg:block")
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")])
    ).toEqual([
      ["Home", "/admin"],
      ["Tasks", "/admin/tasks"],
      ["Members", "/admin/members"],
    ])
    expect(links[0]).not.toHaveAttribute("aria-current")
    expect(links[1]).toHaveAttribute("aria-current", "page")
    expect(links[2]).not.toHaveAttribute("aria-current")
  })

  it.each([
    ["/admin", "Home"],
    ["/admin/tasks", "Tasks"],
    ["/admin/members", "Members"],
    ["/admin/members/x", "Members"],
  ])(
    "marks only %s's area current, in the sidebar and the tab row alike: %s",
    (pathname, current) => {
      usePathname.mockReturnValue(pathname)
      renderShell()

      for (const navName of ["Admin", "Admin areas"]) {
        const nav = screen.getByRole("navigation", { name: navName })
        for (const name of ["Home", "Tasks", "Members"]) {
          const link = within(nav).getByRole("link", { name })
          if (name === current) {
            expect(link).toHaveAttribute("aria-current", "page")
          } else {
            expect(link).not.toHaveAttribute("aria-current")
          }
        }
      }
    }
  )

  it("puts the tab row in the header, below lg, and no menu button", () => {
    renderShell()
    const header = screen.getByRole("banner")
    const tabs = within(header).getByRole("navigation", {
      name: "Admin areas",
    })

    expect(tabs).toHaveClass("lg:hidden")
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["Home", "Tasks", "Members"])
    // The avatar menu's trigger is the header's only button.
    expect(
      within(header)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Head Layout Artist, account"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
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

  it("renders the banners between the header and the content row", () => {
    render(
      <AdminShell
        member={{ name: "Head Layout Artist" }}
        banners={<p>Banner slot</p>}
      >
        <h1>Create a task</h1>
      </AdminShell>
    )
    const header = screen.getByRole("banner")
    const banners = screen.getByText("Banner slot")
    const main = screen.getByRole("main")

    expect(header.nextElementSibling).toBe(banners)
    expect(banners.nextElementSibling).toContainElement(main)
    expect(header).not.toContainElement(banners)
  })

  it("renders the page content in main", () => {
    renderShell()
    expect(screen.getByRole("main")).toHaveTextContent("Create a task")
  })
})
