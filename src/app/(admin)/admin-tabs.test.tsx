// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/admin"),
}))
vi.mock("next/navigation", () => ({ usePathname }))

import { AdminTabs } from "./admin-tabs"

// jsdom has no scrollIntoView; define one so a test can spy on it.
Element.prototype.scrollIntoView ??= () => {}

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const row = () => screen.getByRole("navigation", { name: "Admin areas" })
const tab = (name: string) => within(row()).getByRole("link", { name })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePathname.mockReturnValue("/admin")
})

describe("AdminTabs", () => {
  it("is an Admin areas nav, hidden from lg, reading Home · Tasks · Members", async () => {
    const { container } = render(<AdminTabs />)

    expect(row()).toHaveClass("lg:hidden")
    expect(
      within(row())
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")])
    ).toEqual([
      ["Home", "/admin"],
      ["Tasks", "/admin/tasks"],
      ["Members", "/admin/members"],
    ])
    expect(await axeViolations(container)).toEqual([])
  })

  it("is one sideways-scrolling row with no scrollbar, of 44px tabs that keep their width", () => {
    render(<AdminTabs />)

    expect(row()).toHaveClass(
      "flex",
      "overflow-x-auto",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden"
    )
    for (const link of within(row()).getAllByRole("link")) {
      expect(link).toHaveClass(
        "min-h-11",
        "flex-1",
        "shrink-0",
        "whitespace-nowrap",
        "border-b-3",
        "text-sm",
        "font-semibold"
      )
      // An inset focus outline, since the row clips anything outside it.
      expect(link).toHaveClass(
        "focus-visible:outline-2",
        "focus-visible:-outline-offset-2",
        "focus-visible:outline-white"
      )
      expect(link).not.toHaveClass("focus-visible:outline-offset-2")
    }
  })

  it.each([
    ["/admin", "Home"],
    ["/admin/tasks", "Tasks"],
    ["/admin/members", "Members"],
    ["/admin/members/x", "Members"],
  ])("marks only the current tab on %s: %s", (pathname, current) => {
    usePathname.mockReturnValue(pathname)
    render(<AdminTabs />)

    for (const name of ["Home", "Tasks", "Members"]) {
      if (name === current) {
        expect(tab(name)).toHaveAttribute("aria-current", "page")
        expect(tab(name)).toHaveClass("border-white", "text-white")
      } else {
        expect(tab(name)).not.toHaveAttribute("aria-current")
        expect(tab(name)).toHaveClass("text-white/72")
      }
    }
  })

  it("marks no tab on a path outside the three", () => {
    usePathname.mockReturnValue("/administrator")
    render(<AdminTabs />)

    for (const link of within(row()).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current")
    }
  })

  describe("scrolling the current tab into view", () => {
    // A 200px row starting at x = 16 holding three tabs whose content runs
    // 260px: Home 0–80, Tasks 80–160, Members 160–260 (before scrolling).
    // jsdom has no layout, so the geometry is stubbed: each box is where the
    // element sits for the row's scrollLeft at the moment it is measured.
    // While `layout.hidden` (the row's `lg:hidden`), every box is empty.
    const layout = { hidden: false }
    const ROW_LEFT = 16
    const ROW_WIDTH = 200
    const TABS: Record<string, [start: number, width: number]> = {
      "/admin": [0, 80],
      "/admin/tasks": [80, 80],
      "/admin/members": [160, 100],
    }

    function stubGeometry() {
      layout.hidden = false
      vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
        function (this: Element) {
          return this.tagName === "NAV" && !layout.hidden ? ROW_WIDTH : 0
        }
      )
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          if (layout.hidden) return new DOMRect()
          if (this.tagName === "NAV") {
            return DOMRect.fromRect({
              x: ROW_LEFT,
              width: ROW_WIDTH,
              height: 44,
            })
          }
          const [start, width] = TABS[this.getAttribute("href") ?? ""] ?? [0, 0]
          const scrollLeft = this.closest("nav")?.scrollLeft ?? 0
          return DOMRect.fromRect({
            x: ROW_LEFT + start - scrollLeft,
            width,
            height: 44,
          })
        }
      )
    }

    it("scrolls the row, not the page, so a tab past the right edge shows in full on load", () => {
      stubGeometry()
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView")
      usePathname.mockReturnValue("/admin/members/x")
      render(<AdminTabs />)

      // Members ends at 260, so the row scrolls by 260 - 200.
      expect(row().scrollLeft).toBe(60)
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it("leaves the row where it is when the current tab already shows in full", () => {
      stubGeometry()
      usePathname.mockReturnValue("/admin/tasks")
      render(<AdminTabs />)

      expect(row().scrollLeft).toBe(0)
    })

    it("scrolls again on each navigation: back to a tab past the left edge", () => {
      stubGeometry()
      usePathname.mockReturnValue("/admin/members")
      const { rerender } = render(<AdminTabs />)
      expect(row().scrollLeft).toBe(60)

      usePathname.mockReturnValue("/admin/tasks")
      rerender(<AdminTabs />)
      // Tasks (80–160) shows in full at scrollLeft 60.
      expect(row().scrollLeft).toBe(60)

      usePathname.mockReturnValue("/admin")
      rerender(<AdminTabs />)
      expect(row().scrollLeft).toBe(0)
    })

    // A stand-in that records each observer, so a test can fire it.
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = []
      observed: Element[] = []
      disconnect = vi.fn()
      constructor(readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
      }
      observe(target: Element) {
        this.observed.push(target)
      }
      unobserve() {}
      fire() {
        this.callback([], this as unknown as ResizeObserver)
      }
    }

    function stubResizeObserver() {
      FakeResizeObserver.instances = []
      vi.stubGlobal("ResizeObserver", FakeResizeObserver)
    }

    it("scrolls again when the row's size changes: shown after mounting hidden at lg", () => {
      stubGeometry()
      stubResizeObserver()
      layout.hidden = true
      usePathname.mockReturnValue("/admin/members")
      const { unmount } = render(<AdminTabs />)

      // Hidden, nothing measures, so nothing moves.
      expect(row().scrollLeft).toBe(0)
      const [observer] = FakeResizeObserver.instances
      expect(FakeResizeObserver.instances).toHaveLength(1)
      expect(observer.observed).toEqual([row()])

      // The window shrinks below lg: the row now has its boxes.
      layout.hidden = false
      observer.fire()
      expect(row().scrollLeft).toBe(60)

      unmount()
      expect(observer.disconnect).toHaveBeenCalledOnce()
    })

    it("follows the current tab after a navigation when the size changes", () => {
      stubGeometry()
      stubResizeObserver()
      usePathname.mockReturnValue("/admin/members")
      const { rerender } = render(<AdminTabs />)
      expect(row().scrollLeft).toBe(60)

      usePathname.mockReturnValue("/admin")
      rerender(<AdminTabs />)
      row().scrollLeft = 60
      FakeResizeObserver.instances[0].fire()

      // The one observer reads the tab that is current now: Home.
      expect(FakeResizeObserver.instances).toHaveLength(1)
      expect(row().scrollLeft).toBe(0)
    })

    it("works without ResizeObserver", () => {
      stubGeometry()
      vi.stubGlobal("ResizeObserver", undefined)
      usePathname.mockReturnValue("/admin/members")
      render(<AdminTabs />)

      expect(row().scrollLeft).toBe(60)
    })

    it("shows the start of a tab wider than the row", () => {
      stubGeometry()
      TABS["/admin/members"] = [160, 300]
      try {
        usePathname.mockReturnValue("/admin/members")
        render(<AdminTabs />)
        expect(row().scrollLeft).toBe(160)
      } finally {
        TABS["/admin/members"] = [160, 100]
      }
    })
  })
})
