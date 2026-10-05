// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TaskDetail } from "../queries"
import { TaskDetailView } from "./task-detail-view"

vi.mock("../actions", () => ({
  moveTaskAction: vi.fn(),
  respondToSlotAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// jsdom implements neither PointerEvent capture nor scrollIntoView, which
// Radix's Select relies on to open/scroll its portal content.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const LAYOUT_SLOT = "00000000-0000-4000-8000-000000000031"
const CARTOON_SLOT = "00000000-0000-4000-8000-000000000032"
const WRITER_SLOT = "00000000-0000-4000-8000-000000000033"

const TASK: TaskDetail = {
  id: "00000000-0000-4000-8000-000000000021",
  title: "Lay out the spread",
  description: "Two pages.\nUse the new grid.",
  ownerName: "Layout",
  // 23:30 PHT on Saturday, October 31, 2026.
  dueAt: "2026-10-31T15:30:00+00:00",
  referenceUrl: "https://example.com/brief",
  column: "doing",
  slots: [
    {
      id: LAYOUT_SLOT,
      role: "layout_artist",
      memberId: "00000000-0000-4000-8000-000000000001",
      memberName: "Staff Layout Artist",
      state: "awaiting_response",
      reason: null,
    },
    {
      id: CARTOON_SLOT,
      role: "cartoonist",
      memberId: "00000000-0000-4000-8000-000000000001",
      memberName: "Staff Layout Artist",
      state: "awaiting_response",
      reason: null,
    },
    {
      id: WRITER_SLOT,
      role: "writer",
      memberId: "00000000-0000-4000-8000-000000000002",
      memberName: "Former member",
      state: "needs_reassignment",
      reason: "Exams all week",
    },
  ],
  allowedMoves: ["to_do", "for_review"],
  respondableSlotIds: [CARTOON_SLOT],
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

function slotRows() {
  return within(screen.getByRole("list")).getAllByRole("listitem")
}

describe("TaskDetailView", () => {
  it("shows the title, column, owner, due date in PHT, reference link and description", () => {
    render(<TaskDetailView task={TASK} />)

    expect(
      screen.getByRole("heading", { level: 1, name: "Lay out the spread" })
    ).toHaveClass("font-heading")
    expect(screen.getByText("Doing")).toBeInTheDocument()
    expect(screen.getByText("Owner").nextElementSibling).toHaveTextContent(
      "Layout"
    )
    expect(screen.getByText("Due").nextElementSibling).toHaveTextContent(
      "Sat, Oct 31, 2026 at 11:30 PM"
    )
    const link = screen.getByRole("link", { name: /example\.com\/brief/ })
    expect(link).toHaveAttribute("href", "https://example.com/brief")
    expect(link).toHaveAttribute("target", "_blank")
    expect(screen.getByText(/Two pages\./)).toHaveClass("whitespace-pre-line")
  })

  it("shows one row per slot with its role, member and state badge, and a reason only when there is one", () => {
    render(<TaskDetailView task={TASK} />)

    const rows = slotRows()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent("Layout Artist")
    expect(rows[0]).toHaveTextContent("Staff Layout Artist")
    expect(
      within(rows[0]).getByRole("img", { name: "Status: Awaiting response" })
    ).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent("Former member")
    expect(
      within(rows[2]).getByRole("img", { name: "Status: Needs reassignment" })
    ).toBeInTheDocument()
    expect(
      within(rows[2]).getByText("Reason: Exams all week")
    ).toBeInTheDocument()
    expect(within(rows[0]).queryByText(/^Reason:/)).toBeNull()
  })

  it.each([
    [
      "awaiting_response",
      "Awaiting response",
      "neutral",
      "bg-status-neutral-tint",
    ],
    ["on_it", "On it", "none", null],
    [
      "needs_reassignment",
      "Needs reassignment",
      "attention",
      "bg-status-attention-tint",
    ],
  ] as const)(
    "shows a %s slot's badge as %j in the %s family",
    (state, label, family, tint) => {
      render(
        <TaskDetailView
          task={{ ...TASK, slots: [{ ...TASK.slots[0], state }] }}
        />
      )

      const badge = within(slotRows()[0]).getByRole("img", {
        name: `Status: ${label}`,
      })
      expect(badge).toHaveTextContent(label)
      expect(badge).toHaveAttribute("data-family", family)
      if (tint) {
        expect(badge).toHaveClass(tint)
      } else {
        expect(badge.className).not.toMatch(/\bbg-/)
      }
    }
  )

  it("makes each slot row a focus target, for when its respond buttons go away", () => {
    render(<TaskDetailView task={TASK} />)

    const [layout] = slotRows()
    expect(layout).toHaveAttribute("id", `slot-${LAYOUT_SLOT}`)
    expect(layout).toHaveAttribute("tabindex", "-1")
  })

  it("offers respond buttons only on the slots task_capabilities lists, even for the same member", () => {
    render(<TaskDetailView task={TASK} />)

    const [layout, cartoon, writer] = slotRows()
    expect(within(layout).queryByRole("button")).toBeNull()
    expect(
      within(cartoon).getByRole("button", { name: /^I'm on it/ })
    ).toBeInTheDocument()
    expect(
      within(cartoon).getByRole("button", { name: /^Can't take this/ })
    ).toBeInTheDocument()
    expect(within(writer).queryByRole("button")).toBeNull()
  })

  it("offers Google Calendar with the event prefilled and the link back", async () => {
    const user = userEvent.setup()
    render(<TaskDetailView task={TASK} />)

    await user.click(
      screen.getByRole("button", { name: "Add to Google Calendar" })
    )
    const href =
      screen
        .getByRole("menuitem", { name: /Open in Google Calendar/ })
        .getAttribute("href") ?? ""
    expect(href).toContain("text=Due%3A%20Lay%20out%20the%20spread")
    expect(href).toContain("dates=20261031T153000Z/20261031T154500Z")
    expect(decodeURIComponent(href)).toContain(
      `https://pillar.example/dashboard/tasks/${TASK.id}`
    )
  })

  it("lists exactly the allowed moves", async () => {
    const user = userEvent.setup()
    render(<TaskDetailView task={TASK} />)

    await user.click(screen.getByRole("combobox", { name: "Move to…" }))

    expect(
      within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["To Do", "For Review"])
  })

  it("offers no move control and no respond buttons when task_capabilities allows nothing", () => {
    render(
      <TaskDetailView
        task={{ ...TASK, allowedMoves: [], respondableSlotIds: [] }}
      />
    )

    expect(screen.queryByRole("combobox")).toBeNull()
    // Only the calendar menu remains: it is not a move or a response.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Add to Google Calendar",
    ])
  })

  it("omits the reference link row and the description when they're empty", () => {
    render(
      <TaskDetailView
        task={{ ...TASK, referenceUrl: null, description: null }}
      />
    )

    expect(screen.queryByText("Reference link")).toBeNull()
    expect(screen.queryByText(/Two pages\./)).toBeNull()
  })

  it("shows an unsafe stored link as plain text", () => {
    render(
      <TaskDetailView task={{ ...TASK, referenceUrl: "javascript:alert(1)" }} />
    )

    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument()
  })

  it("has no axe violations", async () => {
    const { container } = render(<TaskDetailView task={TASK} />)
    expect(await axeViolations(container)).toEqual([])
  })
})
