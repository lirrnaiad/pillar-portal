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

import type { PositionGroup } from "../position-groups"
import type { PendingMember } from "../queries"
import { PendingMemberCard } from "./pending-member-card"

const {
  approveMemberAction,
  declineMemberAction,
  refresh,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  approveMemberAction: vi.fn(),
  declineMemberAction: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("../actions", () => ({ approveMemberAction, declineMemberAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

// jsdom implements neither PointerEvent capture nor scrollIntoView, which
// Radix's Select relies on to open and scroll its portal content.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

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

const HEADING_ID = "awaiting-approval-heading"
const STALE =
  "Something changed since you opened this. Review the latest and try again."

const MEMBER: PendingMember = {
  id: "00000000-0000-4000-8000-000000000051",
  name: "Ana Reyes",
  email: "ana.reyes@gmail.com",
  signedInAt: "2026-10-20T01:05:00+00:00",
  signedInLabel: "Tue, Oct 20, 2026 at 9:05 AM PHT",
  lookAlikeName: null,
}

const GROUPS: PositionGroup[] = [
  {
    id: "staff",
    label: "Staff",
    positions: [
      { id: "staff_writer", title: "Staff Writer" },
      { id: "staff_photojournalist", title: "Staff Photojournalist" },
    ],
  },
  {
    id: "heads",
    label: "Heads",
    positions: [{ id: "head_photojournalist", title: "Head Photojournalist" }],
  },
  {
    id: "management",
    label: "Management",
    positions: [{ id: "online_manager", title: "Online Manager" }],
  },
]

// The card as MemberApprovals renders it, under the heading focus goes to.
function Approvals({ members = [MEMBER] }: { members?: PendingMember[] }) {
  return (
    <section aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} tabIndex={-1}>
        Awaiting approval
      </h2>
      <ul>
        {members.map((member) => (
          <PendingMemberCard
            key={member.id}
            member={member}
            positionGroups={GROUPS}
            focusTargetId={HEADING_ID}
          />
        ))}
      </ul>
    </section>
  )
}

const heading = () => screen.getByRole("heading", { name: "Awaiting approval" })
const pickButton = () =>
  screen.getByRole("button", { name: "Pick positions, Ana Reyes" })
const declineButton = () =>
  screen.getByRole("button", { name: "Decline, Ana Reyes" })
const approveButton = () =>
  screen.getByRole("button", { name: "Approve, Ana Reyes" })
const checkbox = (title: string) =>
  screen.getByRole("checkbox", { name: title })
const primarySelect = () =>
  screen.queryByRole("combobox", { name: "Primary position" })

async function choosePrimary(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  await user.click(screen.getByRole("combobox", { name: "Primary position" }))
  await user.click(await screen.findByRole("option", { name: title }))
}

// An action call that stays pending until the test settles it.
function pendingCall(action: typeof approveMemberAction) {
  let settle: (value: unknown) => void = () => {}
  action.mockReturnValue(new Promise((resolve) => (settle = resolve)))
  return (value: unknown) => settle(value)
}

describe("PendingMemberCard", () => {
  it("shows the member's name, email and sign-in time in PHT, with the picker closed", () => {
    render(<Approvals />)

    expect(
      screen.getByRole("heading", { level: 3, name: "Ana Reyes" })
    ).toBeInTheDocument()
    expect(screen.getByText("ana.reyes@gmail.com")).toBeInTheDocument()
    const time = screen.getByText("Tue, Oct 20, 2026 at 9:05 AM PHT")
    expect(time.tagName).toBe("TIME")
    expect(time).toHaveAttribute("datetime", "2026-10-20T01:05:00+00:00")
    expect(time.parentElement).toHaveTextContent(
      "Signed in Tue, Oct 20, 2026 at 9:05 AM PHT"
    )

    expect(pickButton()).toHaveAttribute("aria-expanded", "false")
    expect(pickButton()).toHaveClass("min-h-11")
    expect(declineButton()).toHaveClass("min-h-11")
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("opens one fieldset per group of 44px checkbox rows, Approve disabled, with no axe violations", async () => {
    const user = userEvent.setup()
    const { container } = render(<Approvals />)

    await user.click(pickButton())

    expect(pickButton()).toHaveAttribute("aria-expanded", "true")
    const groups = screen.getAllByRole("group")
    expect(
      groups.map((group) => group.querySelector("legend")?.textContent)
    ).toEqual(["Staff", "Heads", "Management"])
    expect(
      within(groups[0])
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("aria-checked"))
    ).toEqual(["false", "false"])
    expect(checkbox("Staff Writer").parentElement).toHaveClass("min-h-11")
    expect(approveButton()).toBeDisabled()
    expect(approveButton()).toHaveClass("min-h-11")
    expect(await axeViolations(container)).toEqual([])
  })

  it("makes a single checked position primary by itself and enables Approve", async () => {
    const user = userEvent.setup()
    render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))

    expect(checkbox("Staff Writer")).toBeChecked()
    expect(
      screen.getByText("Primary position: Staff Writer")
    ).toBeInTheDocument()
    expect(primarySelect()).toBeNull()
    expect(approveButton()).toBeEnabled()
  })

  it("checks a position from its label too", async () => {
    const user = userEvent.setup()
    render(<Approvals />)

    await user.click(pickButton())
    await user.click(screen.getByText("Online Manager"))

    expect(checkbox("Online Manager")).toBeChecked()
  })

  it("asks for the primary among two or more checked positions, and disables Approve again if the chosen one is unchecked", async () => {
    const user = userEvent.setup()
    const { container } = render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Head Photojournalist"))
    await user.click(checkbox("Staff Photojournalist"))

    expect(primarySelect()).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()
    expect(await axeViolations(container)).toEqual([])

    await user.click(primarySelect()!)
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent)
    ).toEqual(["Staff Photojournalist", "Head Photojournalist"])
    await user.click(
      screen.getByRole("option", { name: "Staff Photojournalist" })
    )
    expect(approveButton()).toBeEnabled()

    await user.click(checkbox("Online Manager"))
    expect(approveButton()).toBeEnabled()

    await user.click(checkbox("Staff Photojournalist"))
    expect(primarySelect()).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()

    await choosePrimary(user, "Online Manager")
    expect(approveButton()).toBeEnabled()
  })

  it("says Choose one in the primary select until a primary is chosen, and again after it is unchecked", async () => {
    const user = userEvent.setup()
    render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))
    await user.click(checkbox("Staff Photojournalist"))
    expect(primarySelect()).toHaveTextContent("Choose one")

    await choosePrimary(user, "Staff Photojournalist")
    expect(primarySelect()).toHaveTextContent("Staff Photojournalist")
    expect(primarySelect()).not.toHaveTextContent("Choose one")

    await user.click(checkbox("Online Manager"))
    await user.click(checkbox("Staff Photojournalist"))
    expect(primarySelect()).toHaveTextContent("Choose one")
    expect(approveButton()).toBeDisabled()
  })

  it("approves with the checked positions in the picker's order, then toasts and focuses the heading", async () => {
    const user = userEvent.setup()
    approveMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: MEMBER.id },
    })
    render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Head Photojournalist"))
    await user.click(checkbox("Staff Photojournalist"))
    await choosePrimary(user, "Staff Photojournalist")
    await user.click(approveButton())

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Ana Reyes approved.")
    )
    expect(approveMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: MEMBER.id,
      positions: ["staff_photojournalist", "head_photojournalist"],
      primaryPosition: "staff_photojournalist",
    })
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(heading()).toHaveFocus()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("asks first when the member may be a second account; Cancel does nothing, confirming approves", async () => {
    const user = userEvent.setup()
    approveMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: MEMBER.id },
    })
    render(
      <Approvals members={[{ ...MEMBER, lookAlikeName: "Ana Reyes-Cruz" }]} />
    )

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))
    await user.click(approveButton())

    const dialog = await screen.findByRole("alertdialog", {
      name: "This may be a second account of Ana Reyes-Cruz.",
    })
    expect(dialog).toHaveAccessibleDescription("Approve anyway?")
    expect(await axeViolations(dialog)).toEqual([])

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(approveMemberAction).not.toHaveBeenCalled()
    await waitFor(() => expect(approveButton()).toHaveFocus())

    await user.click(approveButton())
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Approve",
      })
    )

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Ana Reyes approved.")
    )
    expect(approveMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: MEMBER.id,
      positions: ["staff_writer"],
      primaryPosition: "staff_writer",
    })
    await waitFor(() => expect(heading()).toHaveFocus())
  })

  it("declines after confirming, then toasts and focuses the heading", async () => {
    const user = userEvent.setup()
    declineMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: MEMBER.id },
    })
    render(<Approvals />)

    await user.click(declineButton())
    const dialog = await screen.findByRole("alertdialog", {
      name: "Decline Ana Reyes?",
    })
    expect(dialog).toHaveAccessibleDescription(
      "They'll see Access declined if they sign in again."
    )
    expect(await axeViolations(dialog)).toEqual([])
    expect(declineMemberAction).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Decline" }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Ana Reyes declined.")
    )
    expect(declineMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: MEMBER.id,
    })
    await waitFor(() => expect(heading()).toHaveFocus())
  })

  it("declines nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup()
    render(<Approvals />)

    await user.click(declineButton())
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      })
    )

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(declineMemberAction).not.toHaveBeenCalled()
    await waitFor(() => expect(declineButton()).toHaveFocus())
  })

  it.each(["members.stale", "members.not_found"])(
    "shows the stale copy and re-reads the list when the command answers %s",
    async (code) => {
      const user = userEvent.setup()
      approveMemberAction.mockResolvedValue({ ok: false, code })
      render(<Approvals />)

      await user.click(pickButton())
      await user.click(checkbox("Staff Writer"))
      await user.click(approveButton())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
      expect(refresh).toHaveBeenCalledOnce()
      expect(toastSuccess).not.toHaveBeenCalled()
    }
  )

  it("shows the stale copy when a decline finds the row changed", async () => {
    const user = userEvent.setup()
    declineMemberAction.mockResolvedValue({ ok: false, code: "members.stale" })
    render(<Approvals />)

    await user.click(declineButton())
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Decline",
      })
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it.each([
    [
      "the call throws",
      () => approveMemberAction.mockRejectedValue(new Error("network")),
    ],
    [
      "the command answers members.save_failed",
      () =>
        approveMemberAction.mockResolvedValue({
          ok: false,
          code: "members.save_failed",
        }),
    ],
  ])(
    "shows the generic copy and re-reads the list when %s",
    async (_label, fail) => {
      const user = userEvent.setup()
      fail()
      render(<Approvals />)

      await user.click(pickButton())
      await user.click(checkbox("Staff Writer"))
      await user.click(approveButton())

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
      )
      expect(refresh).toHaveBeenCalledOnce()
    }
  )

  it("keeps every control focusable but inert while a command saves", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(approveMemberAction)
    render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Head Photojournalist"))
    await user.click(checkbox("Staff Photojournalist"))
    await choosePrimary(user, "Head Photojournalist")
    await user.click(approveButton())
    await waitFor(() =>
      expect(approveButton()).toHaveAttribute("aria-disabled", "true")
    )

    for (const control of [
      pickButton(),
      declineButton(),
      checkbox("Staff Writer"),
      primarySelect()!,
    ]) {
      expect(control).toHaveAttribute("aria-disabled", "true")
    }

    await user.click(checkbox("Staff Writer"))
    expect(checkbox("Staff Writer")).not.toBeChecked()
    await user.click(checkbox("Head Photojournalist"))
    expect(checkbox("Head Photojournalist")).toBeChecked()
    await user.click(primarySelect()!)
    expect(screen.queryByRole("option")).toBeNull()
    await user.click(pickButton())
    expect(pickButton()).toHaveAttribute("aria-expanded", "true")
    await user.click(declineButton())
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await user.click(approveButton())
    expect(approveMemberAction).toHaveBeenCalledOnce()
    expect(approveButton()).toHaveFocus()

    settle({ ok: false, code: "members.save_failed" })
    await waitFor(() =>
      expect(approveButton()).not.toHaveAttribute("aria-disabled")
    )
  })

  it("moves focus to the heading when the card goes away with focus inside", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))
    expect(checkbox("Staff Writer")).toHaveFocus()

    rerender(<Approvals members={[]} />)
    expect(heading()).toHaveFocus()
  })

  it("moves focus to the heading when the card goes away while its dialog holds focus", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Approvals />)

    await user.click(declineButton())
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    )

    rerender(<Approvals members={[]} />)
    await waitFor(() => expect(heading()).toHaveFocus())
    // Radix's own focus return, a tick after the dialog goes, doesn't undo it.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(heading()).toHaveFocus()
  })

  it("moves focus to the heading when the card goes away while its primary select's list holds focus", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Approvals />)

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))
    await user.click(checkbox("Staff Photojournalist"))
    await user.click(primarySelect()!)
    const listbox = await screen.findByRole("listbox")
    await waitFor(() =>
      expect(listbox).toContainElement(document.activeElement as HTMLElement)
    )

    rerender(<Approvals members={[]} />)
    await waitFor(() => expect(heading()).toHaveFocus())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(heading()).toHaveFocus()
  })

  it("leaves focus in another card when this card's command succeeds after the admin moved on", async () => {
    const user = userEvent.setup()
    const settle = pendingCall(approveMemberAction)
    const other = {
      ...MEMBER,
      id: "00000000-0000-4000-8000-000000000052",
      name: "Ben Cruz",
    }
    render(<Approvals members={[MEMBER, other]} />)

    await user.click(pickButton())
    await user.click(checkbox("Staff Writer"))
    await user.click(approveButton())
    await waitFor(() =>
      expect(approveButton()).toHaveAttribute("aria-disabled", "true")
    )

    const otherPick = screen.getByRole("button", {
      name: "Pick positions, Ben Cruz",
    })
    await user.click(otherPick)
    expect(otherPick).toHaveFocus()

    settle({ ok: true, data: { memberId: MEMBER.id } })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Ana Reyes approved.")
    )
    expect(otherPick).toHaveFocus()
  })

  it("leaves focus alone when a card goes away without it", async () => {
    const user = userEvent.setup()
    const other = {
      ...MEMBER,
      id: "00000000-0000-4000-8000-000000000052",
      name: "Ben Cruz",
    }
    const { rerender } = render(<Approvals members={[MEMBER, other]} />)

    await user.click(pickButton())
    rerender(<Approvals members={[MEMBER]} />)
    expect(pickButton()).toHaveFocus()
  })
})
