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

import type { HandedBackSlot } from "../queries/handed-back"
import type { ReassignOptions } from "../queries/reassign"
import { HandedBackQueue } from "./handed-back-queue"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { reassignSlotAction, refresh, toastSuccess, toastError } = vi.hoisted(
  () => ({
    reassignSlotAction: vi.fn(),
    refresh: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  })
)

vi.mock("../actions", () => ({ reassignSlotAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const EIC = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Editor-in-Chief",
  openSlots: 4,
}
const STAFF_LAYOUT = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Staff Layout Artist",
  openSlots: 1,
}
const STAFF_CARTOONIST = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Staff Cartoonist",
  openSlots: 0,
}

const OPTIONS: ReassignOptions = {
  slotMembersByRole: { cartoonist: [STAFF_CARTOONIST] },
  allMembers: [EIC, STAFF_LAYOUT, STAFF_CARTOONIST],
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

// Soonest due first, as the read returns them. The second gave no reason.
const RENAMED: HandedBackSlot = {
  slotId: "00000000-0000-4000-8000-000000000031",
  // As PostgREST returns it, microseconds included.
  slotUpdatedAt: "2026-11-02T02:15:42.123456+00:00",
  taskId: "00000000-0000-4000-8000-000000000021",
  taskTitle: "3.7 check (edit) renamed",
  // 23:30 PHT on Saturday, October 31, 2026.
  dueAt: "2026-10-31T15:30:00+00:00",
  role: "cartoonist",
  roleLabel: "Cartoonist",
  memberId: EIC.id,
  memberName: "Editor-in-Chief",
  reason: "Swamped with the issue",
}
const NEXT_WEEK: HandedBackSlot = {
  slotId: "00000000-0000-4000-8000-000000000032",
  slotUpdatedAt: "2026-11-01T08:00:00.5+00:00",
  taskId: "00000000-0000-4000-8000-000000000022",
  taskTitle: "test due next week",
  // 09:00 PHT on Monday, November 9, 2026.
  dueAt: "2026-11-09T01:00:00+00:00",
  role: "layout_artist",
  roleLabel: "Layout Artist",
  memberId: STAFF_LAYOUT.id,
  memberName: "Staff Layout Artist",
  reason: null,
}

// /admin/tasks as it renders the queue: its h1 is the focus target.
function Page({
  slots,
  options = OPTIONS,
}: {
  slots: HandedBackSlot[]
  options?: ReassignOptions | null
}) {
  return (
    <main>
      <h1 id="admin-tasks-heading" tabIndex={-1}>
        Tasks
      </h1>
      <HandedBackQueue
        slots={slots}
        options={options}
        focusTargetId="admin-tasks-heading"
      />
    </main>
  )
}

const heading = () => document.getElementById("admin-tasks-heading")!
const rows = () => within(screen.getByRole("region")).getAllByRole("listitem")
const rowFor = (title: string) =>
  screen
    .getByRole("heading", { level: 3, name: title })
    .closest("li") as HTMLElement
// The "Due <date>" line: its text is split around the <time>.
const dueLine = (row: HTMLElement) =>
  within(row).getByText(
    (_, element) =>
      element?.tagName === "P" && (element.textContent ?? "").startsWith("Due ")
  )
// jsdom drops the space before the sr-only part.
const reassign = (role: string, title: string) =>
  screen.getByRole("button", {
    name: new RegExp(
      `^Reassign\\s?\\(${role}\\), ${title.replace(/[().]/g, "\\$&")}$`
    ),
  })

describe("HandedBackQueue", () => {
  it("renders nothing for an empty queue", () => {
    const { container } = render(
      <HandedBackQueue
        slots={[]}
        options={null}
        focusTargetId="admin-tasks-heading"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("shows a section headed 'Needs reassignment (n)', n counting slots, one card per slot in the order given", () => {
    render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    const section = screen.getByRole("region", {
      name: "Needs reassignment (2)",
    })
    expect(
      within(section).getByRole("heading", {
        level: 2,
        name: "Needs reassignment (2)",
      })
    ).toBeInTheDocument()
    expect(
      within(section)
        .getAllByRole("heading", { level: 3 })
        .map((title) => title.textContent)
    ).toEqual(["3.7 check (edit) renamed", "test due next week"])
    expect(rows()).toHaveLength(2)
  })

  it("counts two slots on one task as two rows", () => {
    render(
      <Page
        slots={[
          RENAMED,
          {
            ...RENAMED,
            slotId: "00000000-0000-4000-8000-000000000033",
            role: "layout_artist",
            roleLabel: "Layout Artist",
            reason: null,
          },
        ]}
      />
    )

    expect(
      screen.getByRole("heading", { level: 2, name: "Needs reassignment (2)" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: /^Reassign\s?\(Cartoonist\), 3\.7 check \(edit\) renamed$/,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: /^Reassign\s?\(Layout Artist\), 3\.7 check \(edit\) renamed$/,
      })
    ).toBeInTheDocument()
  })

  it("shows the title linked to Task detail, the role and who handed it back, the reason and the PHT due date", () => {
    render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    const row = rowFor("3.7 check (edit) renamed")
    expect(
      within(row).getByRole("link", { name: "3.7 check (edit) renamed" })
    ).toHaveAttribute("href", `/dashboard/tasks/${RENAMED.taskId}`)
    expect(
      within(row).getByText("Cartoonist · Editor-in-Chief")
    ).toBeInTheDocument()
    expect(
      within(row).getByText("Reason: Swamped with the issue")
    ).toBeInTheDocument()
    const due = dueLine(row)
    expect(due).toHaveTextContent(/^Due Sat, Oct 31, 11:30 PM$/)
    expect(within(due).getByText("Sat, Oct 31, 11:30 PM")).toHaveAttribute(
      "datetime",
      RENAMED.dueAt
    )
  })

  it("shows no reason line for a slot handed back without one", () => {
    render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    const row = rowFor("test due next week")
    expect(
      within(row).getByText("Layout Artist · Staff Layout Artist")
    ).toBeInTheDocument()
    expect(within(row).queryByText(/^Reason:/)).toBeNull()
    expect(dueLine(row)).toHaveTextContent(/^Due Mon, Nov 9, 9:00 AM$/)
  })

  it("names each Reassign for its role and task, an outline 44px button opening 3.3's picker for that slot", async () => {
    const user = userEvent.setup()
    render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    const button = reassign("Cartoonist", "3.7 check (edit) renamed")
    expect(button).toHaveTextContent(/^Reassign/)
    expect(button).toHaveAttribute("data-variant", "outline")
    expect(button).toHaveClass("min-h-11")
    expect(reassign("Layout Artist", "test due next week")).toBeInTheDocument()

    await user.click(button)

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAccessibleName("Reassign Cartoonist")
    expect(dialog).toHaveAccessibleDescription(
      "Editor-in-Chief · Needs reassignment"
    )
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((input) => input.closest("label")?.textContent)
    ).toEqual([
      "Staff Cartoonist · 0 active",
      "Editor-in-Chief · 4 active (current)",
    ])
  })

  it("reassigns a row, toasts with Copy for Messenger, and focuses the h1 as the row leaves with the count", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: RENAMED.slotId },
    })
    const { rerender } = render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    await user.click(reassign("Cartoonist", "3.7 check (edit) renamed"))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("radio", {
        name: "Staff Cartoonist · 0 active",
      })
    )
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reassign",
      })
    )

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: RENAMED.slotId,
      memberId: STAFF_CARTOONIST.id,
      expectedUpdatedAt: RENAMED.slotUpdatedAt,
    })
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Reassigned to Staff Cartoonist.",
      { action: expect.objectContaining({ label: "Copy for Messenger" }) }
    )
    await waitFor(() =>
      expect(reassign("Cartoonist", "3.7 check (edit) renamed")).toHaveFocus()
    )

    // What revalidation hands back.
    rerender(<Page slots={[NEXT_WEEK]} />)
    expect(
      screen.getByRole("heading", { level: 2, name: "Needs reassignment (1)" })
    ).toBeInTheDocument()
    expect(screen.queryByText("3.7 check (edit) renamed")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("leaves the section out once the last row leaves, with focus on the h1", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: NEXT_WEEK.slotId },
    })
    const { rerender } = render(<Page slots={[NEXT_WEEK]} />)

    await user.click(reassign("Layout Artist", "test due next week"))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("radio", {
        name: "Editor-in-Chief · 4 active",
      })
    )
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reassign",
      })
    )
    await waitFor(() =>
      expect(reassign("Layout Artist", "test due next week")).toHaveFocus()
    )

    rerender(<Page slots={[]} options={null} />)
    expect(screen.queryByRole("region")).toBeNull()
    expect(heading()).toHaveFocus()
  })

  it("has no axe violations", async () => {
    const { container } = render(<Page slots={[RENAMED, NEXT_WEEK]} />)

    expect(await axeViolations(container)).toEqual([])
  })
})
