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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReassignOptions } from "../queries/reassign"
import type { TaskDetail } from "../queries/task-detail"
import { TaskDetailView } from "./task-detail-view"

const {
  deleteTaskAction,
  handBackSlotAction,
  markDoneAction,
  reassignSlotAction,
  refresh,
  reopenTaskAction,
  replace,
  toastSuccess,
} = vi.hoisted(() => ({
  deleteTaskAction: vi.fn(),
  handBackSlotAction: vi.fn(),
  markDoneAction: vi.fn(),
  reassignSlotAction: vi.fn(),
  refresh: vi.fn(),
  reopenTaskAction: vi.fn(),
  replace: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock("../actions", () => ({
  deleteTaskAction,
  handBackSlotAction,
  markDoneAction,
  moveTaskAction: vi.fn(),
  reassignSlotAction,
  reopenTaskAction,
  respondToSlotAction: vi.fn(),
  sendBackTaskAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: toastSuccess } }))

// jsdom implements neither PointerEvent capture nor scrollIntoView, which
// Radix's Select relies on to open/scroll its portal content.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

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
  revisionNote: null,
  slots: [
    {
      id: LAYOUT_SLOT,
      role: "layout_artist",
      memberId: "00000000-0000-4000-8000-000000000001",
      memberName: "Staff Layout Artist",
      state: "awaiting_response",
      reason: null,
      updatedAt: "2026-10-30T02:15:42.000031+00:00",
    },
    {
      id: CARTOON_SLOT,
      role: "cartoonist",
      memberId: "00000000-0000-4000-8000-000000000001",
      memberName: "Staff Layout Artist",
      state: "awaiting_response",
      reason: null,
      updatedAt: "2026-10-30T02:15:42.000032+00:00",
    },
    {
      id: WRITER_SLOT,
      role: "writer",
      memberId: "00000000-0000-4000-8000-000000000002",
      memberName: "Former member",
      state: "needs_reassignment",
      reason: "Exams all week",
      updatedAt: "2026-10-30T02:15:42.000033+00:00",
    },
  ],
  allowedMoves: ["to_do", "for_review"],
  respondableSlotIds: [CARTOON_SLOT],
  handBackSlotIds: [],
  canReview: false,
  canReopen: false,
  canManage: false,
  canReassign: false,
  updatedAt: "2026-10-30T02:15:42.123456+00:00",
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

// The picker's members: Staff Writer (one open slot) is the only one on the
// Writers desk.
const REASSIGN_OPTIONS: ReassignOptions = {
  slotMembersByRole: {
    writer: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Staff Writer",
        openSlots: 1,
      },
    ],
  },
  allMembers: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Staff Layout Artist",
      openSlots: 2,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Staff Writer",
      openSlots: 1,
    },
  ],
  roleLabels: TASK.roleLabels,
}

function slotRows() {
  return within(screen.getByRole("list")).getAllByRole("listitem")
}

describe("TaskDetailView", () => {
  it("offers Copy for Messenger to any viewer", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(<TaskDetailView task={TASK} />)
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    expect(writeText).toHaveBeenCalledWith(
      `📌 Lay out the spread — Layout Artist / Cartoonist / Writer · due Sat, Oct 31, 11:30 PM\nhttps://pillar.example/dashboard/tasks/${TASK.id}`
    )
  })

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

  it("offers Hand back beside the move control only for slots in handBackSlotIds", () => {
    render(
      <TaskDetailView
        task={{
          ...TASK,
          respondableSlotIds: [],
          handBackSlotIds: [LAYOUT_SLOT],
        }}
      />
    )

    const button = screen.getByRole("button", { name: /^Hand back/ })
    expect(button).toHaveAccessibleName(/Hand back.*Layout Artist/)
    expect(button).toHaveAttribute("data-variant", "outline")
    expect(
      screen.getByText(
        "Can't take this? Hand it back — your head will reassign it."
      )
    ).toBeInTheDocument()
  })

  it("sends the id of the slot whose Hand back was used", async () => {
    const user = userEvent.setup()
    handBackSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "needs_reassignment" },
    })
    render(
      <TaskDetailView
        task={{
          ...TASK,
          respondableSlotIds: [],
          handBackSlotIds: [LAYOUT_SLOT, CARTOON_SLOT],
        }}
      />
    )

    await user.click(
      screen.getByRole("button", { name: /^Hand back.*Cartoonist/ })
    )
    await user.click(screen.getByRole("button", { name: "Hand it back" }))

    expect(handBackSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: CARTOON_SLOT,
      reason: "",
    })
    expect(
      screen.getAllByText(
        "Can't take this? Hand it back — your head will reassign it."
      )
    ).toHaveLength(1)
  })

  it("shows no Hand back when nothing may be handed back", () => {
    render(<TaskDetailView task={TASK} />)

    expect(screen.queryByRole("button", { name: /^Hand back/ })).toBeNull()
  })

  it("offers no move control and no respond buttons when task_capabilities allows nothing", () => {
    render(
      <TaskDetailView
        task={{
          ...TASK,
          allowedMoves: [],
          respondableSlotIds: [],
          handBackSlotIds: [],
        }}
      />
    )

    expect(screen.queryByRole("combobox")).toBeNull()
    // Only the calendar menu and Copy for Messenger remain: neither is a move or a response.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Add to Google Calendar",
      "Copy for Messenger",
    ])
  })

  it("shows a sent-back task's revision note under the status, with the approver's name and the PHT date, and the status reads \"Sent back\"", () => {
    render(
      <TaskDetailView
        task={{
          ...TASK,
          revisionNote: {
            text: "Fix the captions.\nAnd the byline.",
            byName: "Head Layout Artist",
            // 00:30 PHT on Sunday, November 1, 2026.
            at: "2026-10-31T16:30:00+00:00",
          },
          // Not a state the database produces together (a sent-back task is
          // in Doing, with nothing to review): here only to pin the order.
          canReview: true,
          respondableSlotIds: [],
          handBackSlotIds: [LAYOUT_SLOT],
        }}
      />
    )

    const status = document.getElementById("task-status")
    expect(status).toHaveTextContent("Status: Sent back")
    const note = screen.getByText(/Fix the captions\./)
    expect(note).toHaveClass("whitespace-pre-line")
    const block = note.parentElement!
    expect(block).toHaveClass(
      "bg-status-attention-tint",
      "border-l-[3px]",
      "border-status-attention",
      "rounded-r-lg"
    )
    const byline = within(block).getByText(/Head Layout Artist/)
    expect(byline).toHaveClass("text-muted-foreground")
    expect(byline).toHaveTextContent(
      "Sent back by Head Layout Artist · Sun, Nov 1, 2026"
    )
    expect(within(byline).getByText("Sent back by")).toHaveClass("sr-only")
    // Under the status, before the actions: the review buttons, then Hand
    // back.
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const markDone = screen.getByRole("button", { name: "Mark done" })
    const handBack = screen.getByRole("button", { name: /^Hand back/ })
    expect(follows(status!, block)).toBe(true)
    expect(follows(block, markDone)).toBe(true)
    expect(follows(block, handBack)).toBe(true)
  })

  it("shows no revision note, and the column as the status, when the task isn't sent back", () => {
    render(<TaskDetailView task={TASK} />)

    expect(document.getElementById("task-status")).toHaveTextContent(
      "Status: Doing"
    )
    expect(screen.queryByText(/Sent back by/)).toBeNull()
  })

  it("offers Mark done and Send back with note only when canReview, and Reopen only when canReopen", () => {
    const { rerender } = render(<TaskDetailView task={TASK} />)
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Send back with note" })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull()

    rerender(
      <TaskDetailView
        task={{ ...TASK, column: "for_review", canReview: true }}
      />
    )
    expect(
      screen.getByRole("button", { name: "Mark done" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Send back with note" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull()

    rerender(
      <TaskDetailView
        task={{ ...TASK, column: "done", allowedMoves: [], canReopen: true }}
      />
    )
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull()
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument()
  })

  // TaskReview's focus target and the status element share one id; a
  // mismatch would leave focus on the page after a save.
  it("puts focus on the status after Mark done", async () => {
    const user = userEvent.setup()
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    render(
      <TaskDetailView
        task={{ ...TASK, column: "for_review", canReview: true }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Mark done" }))

    await waitFor(() =>
      expect(document.getElementById("task-status")).toHaveFocus()
    )
    expect(markDoneAction).toHaveBeenCalledWith({ taskId: TASK.id })
  })

  it("puts focus on the status after Reopen", async () => {
    const user = userEvent.setup()
    reopenTaskAction.mockResolvedValue({ ok: true, data: { column: "doing" } })
    render(
      <TaskDetailView
        task={{ ...TASK, column: "done", allowedMoves: [], canReopen: true }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Reopen" }))

    await waitFor(() =>
      expect(document.getElementById("task-status")).toHaveFocus()
    )
    expect(reopenTaskAction).toHaveBeenCalledWith({ taskId: TASK.id })
  })

  // TaskManage's focus target and the status element share one id too.
  it("puts focus on the status when a refresh after a refused Delete takes the row away", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_approver",
    })
    const { rerender } = render(
      <TaskDetailView task={{ ...TASK, canManage: true }} />
    )

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await user.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus()
    )

    // The refresh shows the caller is no longer the approver.
    rerender(<TaskDetailView task={{ ...TASK, canManage: false }} />)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(document.getElementById("task-status")).toHaveFocus()
  })

  it("offers Delete only when canManage, in its own row after the review buttons", () => {
    const { rerender } = render(<TaskDetailView task={TASK} />)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()

    rerender(
      <TaskDetailView
        task={{
          ...TASK,
          column: "for_review",
          canReview: true,
          canManage: true,
        }}
      />
    )
    const markDone = screen.getByRole("button", { name: "Mark done" })
    const remove = screen.getByRole("button", { name: "Delete" })
    expect(
      markDone.compareDocumentPosition(remove) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(markDone.parentElement?.parentElement).not.toBe(
      remove.parentElement?.parentElement
    )
  })

  it("offers Edit before Delete, both only when canManage", () => {
    const { rerender } = render(<TaskDetailView task={TASK} />)
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull()

    rerender(<TaskDetailView task={{ ...TASK, canManage: true }} />)

    const edit = screen.getByRole("link", { name: "Edit" })
    expect(edit).toHaveAttribute("href", `/admin/tasks/${TASK.id}/edit`)
    expect(
      edit.compareDocumentPosition(
        screen.getByRole("button", { name: "Delete" })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("deletes with the task's id and its version as read, then goes to /admin/tasks", async () => {
    const user = userEvent.setup()
    deleteTaskAction.mockResolvedValue({ ok: true, data: { taskId: TASK.id } })
    render(<TaskDetailView task={{ ...TASK, canManage: true }} />)

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(
      'Delete "Lay out the spread"?'
    )
    await user.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/admin/tasks?notice=task-deleted")
    )
    expect(deleteTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK.id,
      expectedUpdatedAt: "2026-10-30T02:15:42.123456+00:00",
    })
  })

  // jsdom drops the space before an sr-only label ("Reassign(Writer)"), so
  // the names are matched with an optional space.
  it("offers Reassign on every slot only when canReassign, named for each slot's role", () => {
    const { rerender } = render(
      <TaskDetailView task={TASK} reassignOptions={REASSIGN_OPTIONS} />
    )
    expect(screen.queryByRole("button", { name: /^Reassign/ })).toBeNull()

    rerender(
      <TaskDetailView
        task={{ ...TASK, canReassign: true }}
        reassignOptions={REASSIGN_OPTIONS}
      />
    )

    const rows = slotRows()
    expect(
      rows.map(
        (row) =>
          within(row).getAllByRole("button", { name: /^Reassign/ }).length
      )
    ).toEqual([1, 1, 1])
    expect(
      within(rows[0]).getByRole("button", {
        name: /^Reassign\s?\(Layout Artist\)$/,
      })
    ).toHaveAttribute("data-variant", "outline")
    expect(
      within(rows[1]).getByRole("button", {
        name: /^Reassign\s?\(Cartoonist\)$/,
      })
    ).toBeInTheDocument()
    expect(
      within(rows[2]).getByRole("button", { name: /^Reassign\s?\(Writer\)$/ })
    ).toBeInTheDocument()
  })

  it("offers no Reassign without the picker's members", () => {
    render(<TaskDetailView task={{ ...TASK, canReassign: true }} />)

    expect(screen.queryByRole("button", { name: /^Reassign/ })).toBeNull()
  })

  it("opens the picker for the slot whose Reassign was used, and reassigns it with that slot's version", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: WRITER_SLOT },
    })
    render(
      <TaskDetailView
        task={{ ...TASK, canReassign: true }}
        reassignOptions={REASSIGN_OPTIONS}
      />
    )

    // jsdom drops the space before the sr-only role ("Reassign(Writer)").
    await user.click(
      screen.getByRole("button", { name: /^Reassign\s?\(Writer\)$/ })
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAccessibleName("Reassign Writer")
    expect(dialog).toHaveAccessibleDescription(
      "Former member · Needs reassignment"
    )
    await user.click(
      within(dialog).getByRole("radio", { name: "Staff Writer · 1 active" })
    )
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }))

    await waitFor(() =>
      expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
        slotId: WRITER_SLOT,
        memberId: "00000000-0000-4000-8000-000000000003",
        expectedUpdatedAt: "2026-10-30T02:15:42.000033+00:00",
      })
    )
  })

  it("reassigns a slot end to end: its member marked current in the picker, the toast's Copy for Messenger for that slot's role, and focus kept on its row when Reassign goes", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: LAYOUT_SLOT },
    })
    const reassignable = { ...TASK, canReassign: true }
    const { rerender } = render(
      <TaskDetailView task={reassignable} reassignOptions={REASSIGN_OPTIONS} />
    )

    const layoutReassign = () =>
      screen.getByRole("button", { name: /^Reassign\s?\(Layout Artist\)$/ })
    await user.click(layoutReassign())
    const dialog = screen.getByRole("dialog")
    // No one is on the Layout desk here, so the picker lists everyone; the
    // slot's own member is in it.
    expect(
      within(dialog).getByRole("radio", {
        name: "Staff Layout Artist · 2 active (current)",
      })
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("radio", { name: "Staff Writer · 1 active" })
    )
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: LAYOUT_SLOT,
      memberId: "00000000-0000-4000-8000-000000000003",
      expectedUpdatedAt: "2026-10-30T02:15:42.000031+00:00",
    })
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Reassigned to Staff Writer.",
      { action: expect.objectContaining({ label: "Copy for Messenger" }) }
    )

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await toastSuccess.mock.calls[0][1].action.onClick()
    // The task's title, the reassigned slot's role only, the due date in
    // PHT, and the task's own link.
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `📌 Lay out the spread — Layout Artist · due Sat, Oct 31, 11:30 PM\nhttps://pillar.example/dashboard/tasks/${TASK.id}`
    )

    await waitFor(() => expect(layoutReassign()).toHaveFocus())
    // A refresh shows the task can't be reassigned any more.
    rerender(
      <TaskDetailView
        task={{ ...reassignable, canReassign: false }}
        reassignOptions={REASSIGN_OPTIONS}
      />
    )
    expect(screen.queryByRole("button", { name: /^Reassign/ })).toBeNull()
    expect(document.getElementById(`slot-${LAYOUT_SLOT}`)).toHaveFocus()
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

  it("has no axe violations with a revision note, the review buttons, Delete and Reassign", async () => {
    const { container } = render(
      <TaskDetailView
        reassignOptions={REASSIGN_OPTIONS}
        task={{
          ...TASK,
          column: "for_review",
          canReview: true,
          canManage: true,
          canReassign: true,
          revisionNote: {
            text: "Fix the captions.",
            byName: "Head Layout Artist",
            at: "2026-10-31T16:30:00+00:00",
          },
        }}
      />
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
