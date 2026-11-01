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

import type { ReassignOptions } from "../queries/reassign"
import { ReassignSlot } from "./reassign-slot"

const { reassignSlotAction, refresh, toastSuccess, toastError, toastPlain } =
  vi.hoisted(() => ({
    reassignSlotAction: vi.fn(),
    refresh: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastPlain: vi.fn(),
  }))

vi.mock("../actions", () => ({ reassignSlotAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: Object.assign(toastPlain, {
    success: toastSuccess,
    error: toastError,
  }),
}))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

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

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const SLOT_ID = "00000000-0000-4000-8000-000000000032"
const ROW_ID = `slot-${SLOT_ID}`
const STATUS_ID = "task-status"
// As PostgREST returns it, microseconds included.
const VERSION = "2026-10-30T02:15:42.123456+00:00"
const STALE =
  "Something changed since you opened this. Review the latest and try again."

const STAFF_LAYOUT = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Staff Layout Artist",
  openSlots: 1,
}
const HEAD_LAYOUT = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Head Layout Artist",
  openSlots: 3,
}
const HEAD_CARTOONIST = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Head Cartoonist",
  openSlots: 2,
}
const STAFF_CARTOONIST = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "Staff Cartoonist",
  openSlots: 0,
}
const STAFF_WRITER = {
  id: "00000000-0000-4000-8000-000000000005",
  name: "Staff Writer",
  openSlots: 0,
}

// No one is on the Writers desk here, so a Writer slot's picker lists
// everyone.
const OPTIONS: ReassignOptions = {
  slotMembersByRole: {
    cartoonist: [HEAD_CARTOONIST, STAFF_CARTOONIST],
    layout_artist: [STAFF_LAYOUT, HEAD_LAYOUT],
  },
  allMembers: [
    STAFF_LAYOUT,
    HEAD_LAYOUT,
    HEAD_CARTOONIST,
    STAFF_CARTOONIST,
    STAFF_WRITER,
  ],
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

// Task detail's status, the fallback focus target, and the slot row, the
// focus target, with the slot's Reassign. The Cartoonist slot is held by the
// Staff Layout Artist, who isn't on the Cartoon desk, and was handed back.
function Page({
  show = true,
  showRow = true,
  role = "cartoonist",
  memberId = STAFF_LAYOUT.id,
  memberName = STAFF_LAYOUT.name,
  stateLabel = "Needs reassignment",
  version = VERSION,
  options = OPTIONS,
  namedForTask,
}: {
  show?: boolean
  showRow?: boolean
  role?: "cartoonist" | "writer" | "layout_artist"
  memberId?: string
  memberName?: string
  stateLabel?: string
  version?: string
  options?: ReassignOptions
  namedForTask?: boolean
}) {
  return (
    <main>
      <p id={STATUS_ID} tabIndex={-1}>
        Status: Doing
      </p>
      <ul>
        {showRow && (
          <li id={ROW_ID} tabIndex={-1}>
            {options.roleLabels[role]} · {memberName}
            {show && (
              <ReassignSlot
                taskId={TASK_ID}
                taskTitle="Lay out the spread"
                // 23:30 PHT on Saturday, October 31, 2026.
                taskDueAt="2026-10-31T15:30:00+00:00"
                slotId={SLOT_ID}
                role={role}
                memberId={memberId}
                memberName={memberName}
                stateLabel={stateLabel}
                expectedUpdatedAt={version}
                options={options}
                focusTargetId={ROW_ID}
                fallbackFocusTargetId={STATUS_ID}
                namedForTask={namedForTask}
              />
            )}
          </li>
        )}
      </ul>
    </main>
  )
}

// jsdom drops the space before the sr-only role ("Reassign(Cartoonist)").
const trigger = () =>
  screen.getByRole("button", { name: /^Reassign\s?\(Cartoonist\)$/ })
const dialog = () => screen.getByRole("dialog")
const confirm = () => within(dialog()).getByRole("button", { name: "Reassign" })
const cancel = () => within(dialog()).getByRole("button", { name: "Cancel" })
const radio = (name: string) => within(dialog()).getByRole("radio", { name })
const listed = () =>
  within(dialog())
    .getAllByRole("radio")
    .map((input) => input.closest("label")?.textContent)
const showEveryone = () =>
  within(dialog()).getByRole("checkbox", { name: "Show everyone" })
const row = () => document.getElementById(ROW_ID)!
const status = () => document.getElementById(STATUS_ID)!

// An action call that stays pending until the test settles it.
function pendingCall() {
  let settle: (value: unknown) => void = () => {}
  reassignSlotAction.mockReturnValue(
    new Promise((resolve) => (settle = resolve))
  )
  return (value: unknown) => settle(value)
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  return dialog()
}

describe("ReassignSlot", () => {
  it("offers an outline 44px Reassign named for the slot's role, and opens nothing until it's pressed", () => {
    render(<Page />)

    expect(trigger()).toHaveAttribute("data-variant", "outline")
    expect(trigger()).toHaveClass("min-h-11")
    expect(trigger()).toHaveTextContent("Reassign")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("adds the task's title to Reassign's name when asked, for a list of several tasks, and changes nothing else", async () => {
    const user = userEvent.setup()
    render(<Page namedForTask />)

    // jsdom drops the space before the sr-only part.
    const named = screen.getByRole("button", {
      name: /^Reassign\s?\(Cartoonist\), Lay out the spread$/,
    })
    expect(named).toHaveTextContent("Reassign")
    expect(named.querySelector(".sr-only")).toHaveTextContent(
      "(Cartoonist), Lay out the spread"
    )

    await user.click(named)

    expect(dialog()).toHaveAccessibleName("Reassign Cartoonist")
    expect(dialog()).toHaveAccessibleDescription(
      "Staff Layout Artist · Needs reassignment"
    )
  })

  it("opens the picker on a real click, titled for the role and describing who holds the slot and how", async () => {
    const user = userEvent.setup()
    render(<Page />)

    await openPicker(user)

    expect(dialog()).toHaveAccessibleName("Reassign Cartoonist")
    expect(dialog()).toHaveAccessibleDescription(
      "Staff Layout Artist · Needs reassignment"
    )
    expect(
      within(dialog()).getByRole("radiogroup", { name: "Reassign Cartoonist" })
    ).toBeInTheDocument()
    expect(reassignSlotAction).not.toHaveBeenCalled()
  })

  it("lists the role's desk by load, then name, with the slot's member (not on the desk) marked current", async () => {
    const user = userEvent.setup()
    render(<Page />)

    await openPicker(user)

    expect(listed()).toEqual([
      "Staff Cartoonist · 0 active",
      "Staff Layout Artist · 1 active (current)",
      "Head Cartoonist · 2 active",
    ])
    expect(
      within(dialog())
        .getAllByRole<HTMLInputElement>("radio")
        .some((input) => input.checked)
    ).toBe(false)
  })

  it("widens the list to everyone with Show everyone, and narrows it again", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    expect(showEveryone()).not.toBeChecked()
    await user.click(showEveryone())

    expect(listed()).toEqual([
      "Staff Cartoonist · 0 active",
      "Staff Writer · 0 active",
      "Staff Layout Artist · 1 active (current)",
      "Head Cartoonist · 2 active",
      "Head Layout Artist · 3 active",
    ])

    await user.click(showEveryone())
    expect(listed()).toHaveLength(3)
  })

  it("lists everyone under the empty-desk line, with no Show everyone, when no one is on the role's desk", async () => {
    const user = userEvent.setup()
    render(
      <Page
        role="writer"
        memberId={STAFF_WRITER.id}
        memberName="Staff Writer"
        stateLabel="On it"
      />
    )

    await user.click(
      screen.getByRole("button", { name: /^Reassign\s?\(Writer\)$/ })
    )

    expect(
      within(dialog()).getByText("No one on this desk yet — showing everyone.")
    ).toBeInTheDocument()
    expect(listed()).toEqual([
      "Staff Cartoonist · 0 active",
      "Staff Writer · 0 active (current)",
      "Staff Layout Artist · 1 active",
      "Head Cartoonist · 2 active",
      "Head Layout Artist · 3 active",
    ])
    expect(
      within(dialog()).queryByRole("checkbox", { name: "Show everyone" })
    ).toBeNull()
    expect(
      within(dialog()).getByRole("radiogroup", { name: "Reassign Writer" })
    ).toHaveAccessibleDescription("No one on this desk yet — showing everyone.")
  })

  it("offers no Show everyone when the desk is everyone", async () => {
    const user = userEvent.setup()
    render(
      <Page
        options={{
          ...OPTIONS,
          slotMembersByRole: { cartoonist: OPTIONS.allMembers },
        }}
      />
    )

    await openPicker(user)

    expect(listed()).toHaveLength(5)
    expect(
      within(dialog()).queryByRole("checkbox", { name: "Show everyone" })
    ).toBeNull()
  })

  it("doesn't list a current member who isn't active any more", async () => {
    const user = userEvent.setup()
    render(
      <Page
        memberId="00000000-0000-4000-8000-0000000000ff"
        memberName="Former member"
      />
    )

    await openPicker(user)

    expect(dialog()).toHaveAccessibleDescription(
      "Former member · Needs reassignment"
    )
    expect(listed()).toEqual([
      "Staff Cartoonist · 0 active",
      "Head Cartoonist · 2 active",
    ])
  })

  it("keeps Reassign disabled until a member is chosen; every row is 44px and the list scrolls inside the dialog", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    expect(confirm()).toBeDisabled()
    expect(confirm()).toHaveClass("min-h-11")
    expect(cancel()).toHaveClass("min-h-11")
    for (const input of within(dialog()).getAllByRole("radio")) {
      expect(input.closest("label")).toHaveClass("min-h-11")
    }
    expect(within(dialog()).getByRole("radiogroup")).toHaveClass(
      "overflow-y-auto"
    )

    await user.click(radio("Head Cartoonist · 2 active"))

    expect(radio("Head Cartoonist · 2 active")).toBeChecked()
    expect(confirm()).toBeEnabled()
    expect(reassignSlotAction).not.toHaveBeenCalled()
  })

  it("forgets a choice that Show everyone hides again", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    await user.click(showEveryone())
    await user.click(radio("Staff Writer · 0 active"))
    expect(confirm()).toBeEnabled()

    await user.click(showEveryone())
    expect(confirm()).toBeDisabled()

    // Widening again doesn't bring the hidden choice back unpicked.
    await user.click(showEveryone())
    expect(confirm()).toBeDisabled()
    expect(
      within(dialog())
        .getAllByRole<HTMLInputElement>("radio")
        .some((input) => input.checked)
    ).toBe(false)
  })

  it("keeps a desk member chosen through Show everyone and back", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(showEveryone())
    await user.click(showEveryone())

    expect(radio("Head Cartoonist · 2 active")).toBeChecked()
    expect(confirm()).toBeEnabled()
  })

  it("moves the choice with the arrow keys, and Tab reaches Reassign", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    // The first row has focus as the dialog opens; nothing is chosen yet.
    expect(radio("Staff Cartoonist · 0 active")).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(radio("Staff Layout Artist · 1 active (current)")).toBeChecked()
    await user.keyboard("{ArrowDown}")
    expect(radio("Head Cartoonist · 2 active")).toBeChecked()

    await user.tab()
    expect(showEveryone()).toHaveFocus()
    await user.tab()
    expect(cancel()).toHaveFocus()
    await user.tab()
    expect(confirm()).toHaveFocus()
  })

  it("cancels without calling anything, and returns focus to Reassign", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(cancel())

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger()).toHaveFocus())
    expect(reassignSlotAction).not.toHaveBeenCalled()
  })

  it("closes on Escape and returns focus to Reassign, starting fresh next time", async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openPicker(user)
    await user.click(showEveryone())
    await user.click(radio("Staff Writer · 0 active"))

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger()).toHaveFocus())

    await openPicker(user)
    expect(showEveryone()).not.toBeChecked()
    expect(confirm()).toBeDisabled()
  })

  it("reassigns the slot to the chosen member with the version it was rendered from, closes, and toasts the name with Copy for Messenger for this slot's role", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT_ID },
    })
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT_ID,
      memberId: HEAD_CARTOONIST.id,
      expectedUpdatedAt: VERSION,
    })
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Reassigned to Head Cartoonist.",
      { action: expect.objectContaining({ label: "Copy for Messenger" }) }
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger()).toHaveFocus())

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await toastSuccess.mock.calls[0][1].action.onClick()
    // The task's title, this slot's role only, the due date in PHT, the link.
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `📌 Lay out the spread — Cartoonist · due Sat, Oct 31, 11:30 PM\nhttps://pillar.example/dashboard/tasks/${TASK_ID}`
    )
    expect(toastSuccess).toHaveBeenLastCalledWith(
      "Copied — paste it in Messenger."
    )
  })

  it("shows the message to copy by hand when the browser refuses the copy", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT_ID },
    })
    render(<Page />)
    await openPicker(user)
    await user.click(radio("Staff Cartoonist · 0 active"))
    await user.click(confirm())
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce())

    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    await toastSuccess.mock.calls[0][1].action.onClick()

    expect(toastPlain).toHaveBeenCalledWith(
      "Copy this and paste it in Messenger.",
      expect.objectContaining({
        description: expect.stringContaining("Lay out the spread — Cartoonist"),
      })
    )
  })

  it("passes the slot's version from when the picker opened, even after a refresh brings a newer one", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT_ID },
    })
    const { rerender } = render(<Page />)
    await openPicker(user)

    // The assignee answered while the picker was open; a refresh brought it.
    rerender(<Page version="2026-10-30T02:20:00.000001+00:00" />)
    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() =>
      expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
        slotId: SLOT_ID,
        memberId: HEAD_CARTOONIST.id,
        expectedUpdatedAt: VERSION,
      })
    )
  })

  it("passes the version as it is when the picker opens again", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT_ID },
    })
    const NEWER = "2026-10-30T02:20:00.000001+00:00"
    const { rerender } = render(<Page />)
    await openPicker(user)
    await user.click(cancel())
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    rerender(<Page version={NEWER} />)
    await openPicker(user)
    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() =>
      expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
        slotId: SLOT_ID,
        memberId: HEAD_CARTOONIST.id,
        expectedUpdatedAt: NEWER,
      })
    )
  })

  it("resets the slot when its current member is picked, and still offers Copy for Messenger", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT_ID },
    })
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Staff Layout Artist · 1 active (current)"))
    await user.click(confirm())

    await waitFor(() =>
      expect(reassignSlotAction).toHaveBeenCalledExactlyOnceWith({
        slotId: SLOT_ID,
        memberId: STAFF_LAYOUT.id,
        expectedUpdatedAt: VERSION,
      })
    )
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Reassigned to Staff Layout Artist.",
      { action: expect.objectContaining({ label: "Copy for Messenger" }) }
    )
  })

  it("keeps the dialog open and inert while the reassign saves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall()
    render(<Page />)
    await openPicker(user)
    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() =>
      expect(confirm()).toHaveAttribute("aria-disabled", "true")
    )
    expect(cancel()).toHaveAttribute("aria-disabled", "true")
    expect(confirm()).toBeEnabled()

    await user.keyboard("{Escape}")
    await user.click(cancel())
    await user.click(radio("Staff Cartoonist · 0 active"))
    await user.click(confirm())
    expect(dialog()).toBeInTheDocument()
    expect(radio("Head Cartoonist · 2 active")).toBeChecked()
    expect(reassignSlotAction).toHaveBeenCalledOnce()

    settle({ ok: true, data: { slotId: SLOT_ID } })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith(
      "Reassigned to Head Cartoonist.",
      expect.anything()
    )
  })

  it("names the member picked when they already hold this role on the task, and keeps the dialog open with the choice cleared", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: false,
      code: "tasks.duplicate_slot",
    })
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        "Head Cartoonist already has this role on this task."
      )
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(dialog()).toBeInTheDocument()
    await waitFor(() => expect(confirm()).toBeDisabled())
    expect(
      within(dialog())
        .getAllByRole<HTMLInputElement>("radio")
        .some((input) => input.checked)
    ).toBe(false)
    expect(radio("Staff Cartoonist · 0 active")).toHaveFocus()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("shows the stale line, closes the picker, re-reads the page and returns focus to Reassign when the slot changed since it loaded", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger()).toHaveFocus())
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it.each([
    ["tasks.invalid_slot_member", STALE],
    ["tasks.not_found", "This task was deleted or the link is wrong."],
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["tasks.not_allowed", "Couldn't save — try again."],
    ["auth.not_active", "Sign in to do that."],
    ["tasks.save_failed", "Couldn't save — try again."],
  ])(
    "toasts %s's copy, re-reads the page and closes the picker",
    async (code, copy) => {
      const user = userEvent.setup()
      reassignSlotAction.mockResolvedValue({ ok: false, code })
      render(<Page />)
      await openPicker(user)

      await user.click(radio("Head Cartoonist · 2 active"))
      await user.click(confirm())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).toHaveBeenCalledOnce()
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    }
  )

  it("toasts the generic copy and closes the picker when the call itself fails", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockRejectedValue(new Error("network"))
    render(<Page />)
    await openPicker(user)

    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("moves focus to the slot's row when a refresh takes Reassign away while it has focus", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_allowed",
    })
    const { rerender } = render(<Page />)
    await openPicker(user)
    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())
    await waitFor(() => expect(trigger()).toHaveFocus())

    // The refresh shows the task was marked Done meanwhile.
    rerender(<Page show={false} />)

    expect(screen.queryByRole("button", { name: /^Reassign/ })).toBeNull()
    expect(row()).toHaveFocus()
  })

  it("moves focus to the slot's row when a refresh takes Reassign away with the picker open", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page />)
    await openPicker(user)

    rerender(<Page show={false} />)

    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(row()).toHaveFocus())
  })

  it("moves focus to the fallback when a refresh after a refused reassign takes the slot's row away too", async () => {
    const user = userEvent.setup()
    reassignSlotAction.mockResolvedValue({ ok: false, code: "tasks.not_found" })
    const { rerender } = render(<Page />)
    await openPicker(user)
    await user.click(radio("Head Cartoonist · 2 active"))
    await user.click(confirm())
    await waitFor(() => expect(trigger()).toHaveFocus())

    // Another approver's edit removed the slot.
    rerender(<Page showRow={false} />)

    expect(document.getElementById(ROW_ID)).toBeNull()
    await waitFor(() => expect(status()).toHaveFocus())
  })

  it("moves focus to the fallback when the slot's row goes with the picker open", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page />)
    await openPicker(user)

    rerender(<Page showRow={false} />)

    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(status()).toHaveFocus())
  })

  it("has no axe violations, with Reassign and with the picker open", async () => {
    const user = userEvent.setup()
    const { container } = render(<Page />)
    expect(await axeViolations(container)).toEqual([])

    await openPicker(user)
    expect(await axeViolations(dialog())).toEqual([])
  })
})
