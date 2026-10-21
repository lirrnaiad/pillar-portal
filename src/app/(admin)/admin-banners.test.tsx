// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { ReactElement } from "react"
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

import type { AdminBanner } from "@/lib/admin-banners"

// The slot reads this list; each test fills it with its fixtures. `after`
// holds each scheduled callback; runAfter() runs them, as Next does once the
// response is sent.
const { after, recordErrorEvent, sources } = vi.hoisted(() => ({
  after: vi.fn<(task: () => unknown) => void>(),
  recordErrorEvent: vi.fn(async () => {}),
  sources: [] as (() => Promise<AdminBanner[]>)[],
}))
vi.mock("./admin-banner-sources", () => ({ ADMIN_BANNER_SOURCES: sources }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))

import { AdminBanners, AdminBannerSlot } from "./admin-banners"

const BACKUP: AdminBanner = {
  id: "backup-overdue",
  family: "attention",
  text: "Last backup was 9 days ago.",
  since: "2026-10-11T00:00:00.000Z",
}
const JOBS: AdminBanner = {
  id: "daily-jobs-stale",
  family: "attention",
  text: "Daily jobs haven't run since Oct 18, 8:04 AM.",
  since: "2026-10-18T00:04:00.000Z",
}
const RESET: AdminBanner = {
  id: "reset-scheduled",
  family: "progress",
  text: "School-year reset scheduled for Oct 23, between 8 and 9 AM.",
  since: "2026-10-01T00:00:00.000Z",
}
const ERASURE: AdminBanner = {
  id: "erasure-scheduled",
  family: "progress",
  text: "Applicant data for 2026 will be erased on Oct 30, between 8 and 9 AM.",
  since: "2026-10-05T00:00:00.000Z",
}

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

// Renders the slot as the layout would: the async component's element.
async function renderSlot() {
  const element = (await AdminBannerSlot()) as ReactElement
  return render(element)
}

const barTexts = () =>
  within(screen.getByRole("region", { name: "Notices" }))
    .getAllByRole("paragraph")
    .map((p) => p.textContent)

async function runAfter() {
  for (const [task] of after.mock.calls) await task()
}

afterEach(() => {
  cleanup()
  sources.length = 0
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("AdminBannerSlot", () => {
  it("renders nothing, not even the region, with no banners", async () => {
    sources.push(async () => [])
    const { container } = await renderSlot()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("region")).not.toBeInTheDocument()
  })

  it("renders nothing with no sources at all", async () => {
    const { container } = await renderSlot()
    expect(container).toBeEmptyDOMElement()
  })

  it("renders one banner as one bar: the family's dot beside the text, no Cancel", async () => {
    sources.push(async () => [BACKUP])
    const { container } = await renderSlot()

    const region = screen.getByRole("region", { name: "Notices" })
    expect(barTexts()).toEqual([BACKUP.text])
    const dot = region.querySelector('[data-family="attention"]')
    expect(dot).toHaveAttribute("aria-hidden", "true")
    expect(dot).toHaveClass("bg-status-attention")
    expect(within(region).queryByRole("button")).not.toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it("shows the first three of four from every source: attention first, oldest first", async () => {
    sources.push(
      async () => [RESET, JOBS],
      async () => [ERASURE, BACKUP]
    )
    await renderSlot()

    expect(barTexts()).toEqual([BACKUP.text, JOBS.text, RESET.text])
    const region = screen.getByRole("region", { name: "Notices" })
    expect(
      [...region.querySelectorAll("[data-family]")].map((dot) =>
        dot.getAttribute("data-family")
      )
    ).toEqual(["attention", "attention", "progress"])
  })

  it("reads every source in parallel", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const first = vi.fn(async () => {
      await gate
      return [BACKUP]
    })
    const second = vi.fn(async () => [RESET])
    sources.push(first, second)

    const slot = AdminBannerSlot()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    release()
    render((await slot) as ReactElement)

    expect(barTexts()).toEqual([BACKUP.text, RESET.text])
  })

  it("logs a throwing source's error and skips it, still showing the others", async () => {
    const failure = new Error("backup source failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    sources.push(
      async () => [RESET],
      async () => {
        throw failure
      },
      async () => [BACKUP]
    )
    await renderSlot()

    expect(barTexts()).toEqual([BACKUP.text, RESET.text])
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it("records a throwing source's error after the response, by its index", async () => {
    const failure = new Error("backup source failed")
    vi.spyOn(console, "error").mockImplementation(() => {})
    sources.push(
      async () => [RESET],
      async () => {
        throw failure
      }
    )
    await renderSlot()

    expect(recordErrorEvent).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()

    await runAfter()
    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(failure, {
      route: "render admin-banners #1",
    })
  })

  it("records nothing when every source answers", async () => {
    sources.push(
      async () => [RESET],
      async () => []
    )
    await renderSlot()

    expect(after).not.toHaveBeenCalled()
  })

  it("renders nothing, and logs, when the only source throws", async () => {
    const failure = new Error("backup source failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    sources.push(async () => {
      throw failure
    })
    const { container } = await renderSlot()

    expect(container).toBeEmptyDOMElement()
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(failure)
  })
})

describe("AdminBanners", () => {
  it("renders an outline Cancel, described by the banner text, that submits the banner's action", async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const { container } = render(
      <AdminBanners banners={[{ ...RESET, cancel }, BACKUP]} />
    )

    const button = screen.getByRole("button", { name: "Cancel" })
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(button).toHaveAccessibleDescription(RESET.text)
    expect(button).toHaveAttribute("data-variant", "outline")
    expect(button).toHaveClass("min-h-11", "min-w-11")
    expect(button.closest("form")).not.toBeNull()
    expect(await axeViolations(container)).toEqual([])

    await user.click(button)
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(cancel.mock.calls[0][0]).toBeInstanceOf(FormData)
  })

  it("renders the banners in the order given, each a full-width muted bar", () => {
    render(<AdminBanners banners={[RESET, BACKUP]} />)

    expect(barTexts()).toEqual([RESET.text, BACKUP.text])
    const bars = screen.getByRole("region", { name: "Notices" }).children
    for (const bar of bars) {
      expect(bar).toHaveClass("bg-muted")
      expect(bar.firstElementChild).toHaveClass("max-w-[1440px]")
    }
  })
})
