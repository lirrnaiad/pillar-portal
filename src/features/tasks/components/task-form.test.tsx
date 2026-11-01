// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TaskEdit } from "../queries/task-edit"
import type { TaskFormOptions } from "../queries/task-form"
import { taskEditKey } from "../task-edit-key"
import { TaskForm } from "./task-form"

const {
  createTaskAction,
  updateTaskAction,
  push,
  refresh,
  toastSuccess,
  toastError,
  toastPlain,
} = vi.hoisted(() => ({
  createTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastPlain: vi.fn(),
}))

vi.mock("../actions", () => ({ createTaskAction, updateTaskAction }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(toastPlain, {
    success: toastSuccess,
    error: toastError,
  }),
}))
// TaskForm imports PRODUCTION_ROLE_LABELS through @/features/members, whose
// index.ts also pulls in actions.ts (env.client) and queries.ts
// (supabase/server) at module load. Neither is exercised by this component.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

// jsdom implements neither PointerEvent capture nor scrollIntoView, which
// Radix's Select relies on to open/scroll its portal content.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

// taskCreateSchema requires slot member ids to be real UUIDs (member_directory
// ids are), so the fixtures use UUID-shaped ids even though nothing else
// about them is meaningful here.
const MEMBER_1 = "00000000-0000-4000-8000-000000000001"
const MEMBER_2 = "00000000-0000-4000-8000-000000000002"

const OPTIONS: TaskFormOptions = {
  owners: [
    { kind: "section", id: "news", name: "News" },
    { kind: "desk", id: "layout", name: "Layout" },
  ],
  slotMembersByRole: {
    layout_artist: [{ id: MEMBER_1, name: "Staff Layout Artist" }],
    cartoonist: [{ id: MEMBER_2, name: "Head Layout Artist" }],
  },
  allMembers: [
    { id: MEMBER_1, name: "Staff Layout Artist" },
    { id: MEMBER_2, name: "Head Layout Artist" },
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

function renderForm(options: TaskFormOptions = OPTIONS) {
  return render(<TaskForm options={options} />)
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string | RegExp,
  optionName: string | RegExp
) {
  await user.click(screen.getByRole("combobox", { name: comboboxName }))
  await user.click(await screen.findByRole("option", { name: optionName }))
}

// Fills every required field except the ones the caller overrides, so each
// test only has to describe what it cares about.
async function fillMinimalValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Title"), "Lay out the spread")
  await chooseOption(user, "Owner", "News")
  await chooseOption(user, "Role", "Layout Artist")
  await chooseOption(user, "Member", "Staff Layout Artist")
  // userEvent.type() sends keystrokes one at a time, and a datetime-local
  // input rejects an incomplete partial value along the way; set it in one
  // go instead, as a browser's native picker would.
  fireEvent.change(screen.getByLabelText("Due date"), {
    target: { value: "2026-11-01T09:00" },
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("TaskForm", () => {
  it("has no axe violations", async () => {
    const { container } = renderForm()
    expect(await axeViolations(container)).toEqual([])
  })

  it("shows no owner error after choosing a desk, from a fresh form or after a section", async () => {
    const user = userEvent.setup()
    renderForm()

    await chooseOption(user, "Owner", "Layout")
    expect(screen.queryByText("Choose one owner")).not.toBeInTheDocument()

    await chooseOption(user, "Owner", "News")
    await chooseOption(user, "Owner", "Layout")
    expect(screen.queryByText("Choose one owner")).not.toBeInTheDocument()
  })

  it("clears the owner error a submit left once an owner is chosen", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole("button", { name: "Create task" }))
    expect(await screen.findByText("Choose one owner")).toBeInTheDocument()

    await chooseOption(user, "Owner", "Layout")
    await waitFor(() =>
      expect(screen.queryByText("Choose one owner")).not.toBeInTheDocument()
    )
  })

  it("offers exactly the owners it's given, and nothing else (Writers is never among them)", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole("combobox", { name: "Owner" }))
    const listbox = await screen.findByRole("listbox")
    const optionNames = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent)

    expect(optionNames).toEqual(["News", "Layout"])
    expect(optionNames).not.toContain("Writers")
  })

  it("blocks submit and focuses the due date field when it's empty", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText("Title"), "Lay out the spread")
    await chooseOption(user, "Owner", "News")
    await chooseOption(user, "Role", "Layout Artist")
    await chooseOption(user, "Member", "Staff Layout Artist")

    await user.click(screen.getByRole("button", { name: "Create task" }))

    expect(await screen.findByText("Add a due date")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Due date")).toHaveFocus())
    expect(createTaskAction).not.toHaveBeenCalled()
  })

  it("blocks submit with an inline error on a malformed reference link", async () => {
    const user = userEvent.setup()
    renderForm()

    await fillMinimalValidForm(user)
    await user.type(screen.getByLabelText("Reference link"), "not-a-url")
    await user.click(screen.getByRole("button", { name: "Create task" }))

    expect(await screen.findByText("Enter a valid link")).toBeInTheDocument()
    expect(createTaskAction).not.toHaveBeenCalled()
  })

  it("submits the parsed data, toasts Task created, and resets while keeping the owner", async () => {
    createTaskAction.mockResolvedValue({ ok: true, data: { id: "task-1" } })
    const user = userEvent.setup()
    renderForm()

    await fillMinimalValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledOnce())
    expect(createTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Lay out the spread",
        owningSectionId: "news",
        owningDeskId: null,
        dueAt: "2026-11-01T09:00",
        referenceUrl: null,
        description: null,
        slots: [{ role: "layout_artist", memberId: MEMBER_1 }],
      })
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Task created", {
        action: expect.objectContaining({ label: "Copy for Messenger" }),
      })
    )
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await toastSuccess.mock.calls[0][1].action.onClick()
    expect(toastSuccess).toHaveBeenCalledWith("Copied — paste it in Messenger.")
    // 09:00 on 2026-11-01 PHT, one Layout Artist slot, the new task's id.
    expect(writeText).toHaveBeenCalledWith(
      "📌 Lay out the spread — Layout Artist · due Sun, Nov 1, 9:00 AM\nhttps://pillar.example/dashboard/tasks/task-1"
    )
    vi.unstubAllGlobals()

    // Reset: the title is cleared...
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue(""))
    // ...but the owner survives the reset.
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveTextContent(
      "News"
    )
  })

  it("shows the message in a toast when the action can't reach the clipboard", async () => {
    createTaskAction.mockResolvedValue({ ok: true, data: { id: "task-1" } })
    const user = userEvent.setup()
    renderForm()
    await fillMinimalValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create task" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

    vi.stubGlobal("navigator", {})
    await toastSuccess.mock.calls[0][1].action.onClick()
    vi.unstubAllGlobals()
    expect(toastPlain).toHaveBeenCalledWith(
      "Copy this and paste it in Messenger.",
      expect.objectContaining({
        description: expect.stringContaining("/dashboard/tasks/task-1"),
      })
    )
    expect(toastSuccess).not.toHaveBeenCalledWith(
      "Copied — paste it in Messenger."
    )
  })

  it("toasts the mapped error and doesn't reset when the action fails", async () => {
    createTaskAction.mockResolvedValue({ ok: false, code: "tasks.not_admin" })
    const user = userEvent.setup()
    renderForm()

    await fillMinimalValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only the Editorial Board can create tasks."
      )
    )
    expect(screen.getByLabelText("Title")).toHaveValue("Lay out the spread")
  })

  it("toasts a generic error and doesn't crash when the action call itself fails", async () => {
    createTaskAction.mockRejectedValue(new Error("network error"))
    const user = userEvent.setup()
    renderForm()

    await fillMinimalValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't create the task. Try again."
      )
    )
  })

  it("clears the chosen member when the slot's role changes", async () => {
    const user = userEvent.setup()
    renderForm()

    await chooseOption(user, "Role", "Layout Artist")
    await chooseOption(user, "Member", "Staff Layout Artist")
    expect(screen.getByRole("combobox", { name: "Member" })).toHaveTextContent(
      "Staff Layout Artist"
    )

    await chooseOption(user, "Role", "Cartoonist")

    expect(screen.getByRole("combobox", { name: "Member" })).toHaveTextContent(
      "Choose a member"
    )
  })

  it("submits Create task, not Save changes, and calls no edit action", async () => {
    createTaskAction.mockResolvedValue({ ok: true, data: { id: "task-1" } })
    const user = userEvent.setup()
    renderForm()

    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    await fillMinimalValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledOnce())
    expect(updateTaskAction).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it("adds and removes slot rows, keeping at least one", async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.getAllByRole("combobox", { name: "Role" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /Remove slot/ })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Add slot" }))

    expect(screen.getAllByRole("combobox", { name: "Role" })).toHaveLength(2)
    const removeButtons = screen.getAllByRole("button", { name: /Remove slot/ })
    expect(removeButtons).toHaveLength(2)

    await user.click(removeButtons[0])

    expect(screen.getAllByRole("combobox", { name: "Role" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /Remove slot/ })).toBeNull()
  })
})

// Edit mode (Story 3.7).

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const SLOT_A = "00000000-0000-4000-8000-000000000031"
const SLOT_B = "00000000-0000-4000-8000-000000000032"
const SLOT_C = "00000000-0000-4000-8000-000000000033"
// Not active any more: in no picker list.
const FORMER = "00000000-0000-4000-8000-000000000009"
const STALE =
  "Something changed since you opened this. Review the latest and try again."

// SLOT_A's member is on the Layout Artist desk list; SLOT_B's isn't on the
// Cartoonist one; SLOT_C's member left (the read names them "Former member").
const TASK: TaskEdit = {
  id: TASK_ID,
  title: "Lay out the spread",
  description: "Two pages.",
  ownerName: "Layout",
  dueAtInput: "2026-10-31T23:30",
  referenceUrl: "https://example.com/brief",
  slots: [
    {
      id: SLOT_A,
      role: "layout_artist",
      memberId: MEMBER_1,
      memberName: "Staff Layout Artist",
    },
    {
      id: SLOT_B,
      role: "cartoonist",
      memberId: MEMBER_1,
      memberName: "Staff Layout Artist",
    },
    {
      id: SLOT_C,
      role: "photojournalist",
      memberId: FORMER,
      memberName: "Former member",
    },
  ],
  done: false,
  canManage: true,
  updatedAt: "2026-10-30T02:15:42.123456+00:00",
}

const LOADED_SLOTS = [
  { id: SLOT_A, role: "layout_artist", memberId: MEMBER_1 },
  { id: SLOT_B, role: "cartoonist", memberId: MEMBER_1 },
  { id: SLOT_C, role: "photojournalist", memberId: FORMER },
]

// As the edit page renders it: keyed with taskEditKey, so a re-read that
// brings a newer task remounts the form.
function EditPage({ task = TASK }: { task?: TaskEdit }) {
  return <TaskForm key={taskEditKey(task)} options={OPTIONS} task={task} />
}

const memberBoxes = () => screen.getAllByRole("combobox", { name: "Member" })
const save = () => screen.getByRole("button", { name: "Save changes" })

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
  optionName: string
) {
  await user.click(combobox)
  await user.click(await screen.findByRole("option", { name: optionName }))
}

describe("TaskForm in edit mode", () => {
  it("opens prefilled, with the due date as PHT and Save changes instead of Create task", () => {
    render(<EditPage />)

    expect(screen.getByLabelText("Title")).toHaveValue("Lay out the spread")
    expect(screen.getByLabelText("Description")).toHaveValue("Two pages.")
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-10-31T23:30")
    expect(screen.getByLabelText("Reference link")).toHaveValue(
      "https://example.com/brief"
    )
    expect(memberBoxes().map((box) => box.textContent)).toEqual([
      "Staff Layout Artist",
      "Staff Layout Artist",
      "Former member",
    ])
    expect(save()).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull()
  })

  it("shows the owner as read-only text, with no owner picker", () => {
    render(<EditPage />)

    expect(screen.queryByRole("combobox", { name: "Owner" })).toBeNull()
    expect(screen.getByRole("group", { name: "Owner" })).toHaveTextContent(
      "Layout"
    )
  })

  it("shows each existing slot's role read-only, and offers a role picker only on a new slot", async () => {
    const user = userEvent.setup()
    render(<EditPage />)

    expect(screen.queryByRole("combobox", { name: "Role" })).toBeNull()
    expect(
      screen
        .getAllByRole("group", { name: "Role" })
        .map((group) => group.textContent)
    ).toEqual(["RoleLayout Artist", "RoleCartoonist", "RolePhotojournalist"])

    await user.click(screen.getByRole("button", { name: "Add slot" }))

    expect(screen.getAllByRole("combobox", { name: "Role" })).toHaveLength(1)
  })

  it("starts Show everyone on only for a slot whose member isn't on the role's desk list", () => {
    render(<EditPage />)

    // SLOT_C's role has no desk list, so it has no Show everyone at all.
    const toggles = screen.getAllByRole("checkbox", { name: "Show everyone" })
    expect(toggles).toHaveLength(2)
    expect(toggles[0]).not.toBeChecked()
    expect(toggles[1]).toBeChecked()
  })

  it('keeps a member the pickers no longer offer as "Former member"', async () => {
    const user = userEvent.setup()
    render(<EditPage />)

    await user.click(memberBoxes()[2])
    const names = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent)

    expect(names).toEqual([
      "Staff Layout Artist",
      "Head Layout Artist",
      "Former member",
    ])
  })

  it("saves the task id, the fields and every slot (ids on the existing ones only, no owner), toasts Task saved. with no action, and goes to Task detail", async () => {
    updateTaskAction.mockResolvedValue({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: false },
    })
    const user = userEvent.setup()
    render(<EditPage />)

    await user.clear(screen.getByLabelText("Title"))
    await user.type(screen.getByLabelText("Title"), "Lay out the spread, v2")
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-05T17:00" },
    })
    await user.click(save())

    await waitFor(() =>
      expect(push).toHaveBeenCalledExactlyOnceWith(
        `/dashboard/tasks/${TASK_ID}`
      )
    )
    expect(updateTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: TASK_ID,
      title: "Lay out the spread, v2",
      description: "Two pages.",
      dueAt: "2026-11-05T17:00",
      referenceUrl: "https://example.com/brief",
      slots: LOADED_SLOTS,
    })
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Task saved.",
      undefined
    )
    expect(createTaskAction).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    // Nothing resends the save while the page leaves.
    expect(save()).toBeDisabled()
  })

  it("sends a reassigned slot with its id and a new one without, and offers Copy for Messenger when a slot got a new member", async () => {
    updateTaskAction.mockResolvedValue({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: true },
    })
    const user = userEvent.setup()
    render(<EditPage />)

    await choose(user, memberBoxes()[1], "Head Layout Artist")
    await user.click(screen.getByRole("button", { name: "Add slot" }))
    await choose(user, memberBoxes()[3], "Head Layout Artist")
    await user.click(save())

    await waitFor(() => expect(push).toHaveBeenCalledOnce())
    expect(updateTaskAction.mock.calls[0][0].slots).toEqual([
      { id: SLOT_A, role: "layout_artist", memberId: MEMBER_1 },
      { id: SLOT_B, role: "cartoonist", memberId: MEMBER_2 },
      { id: SLOT_C, role: "photojournalist", memberId: FORMER },
      { role: "writer", memberId: MEMBER_2 },
    ])
    expect(toastSuccess).toHaveBeenCalledWith("Task saved.", {
      action: expect.objectContaining({ label: "Copy for Messenger" }),
    })

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await toastSuccess.mock.calls[0][1].action.onClick()
    expect(toastSuccess).toHaveBeenCalledWith("Copied — paste it in Messenger.")
    // 23:30 on 2026-10-31 PHT, every slot's role, the task's own link.
    expect(writeText).toHaveBeenCalledWith(
      `📌 Lay out the spread — Layout Artist / Cartoonist / Photojournalist / Writer · due Sat, Oct 31, 11:30 PM\nhttps://pillar.example/dashboard/tasks/${TASK_ID}`
    )
  })

  it.each([
    ["tasks.stale", STALE],
    ["tasks.not_found", "This task was deleted or the link is wrong."],
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["auth.not_active", "Sign in to do that."],
    // A member the form offered left while it was open.
    ["tasks.invalid_slot_member", STALE],
    // The task was marked Done while the form was open.
    ["tasks.not_allowed", "Couldn't save — try again."],
  ])("toasts %s's copy and re-reads the page", async (code, copy) => {
    updateTaskAction.mockResolvedValue({ ok: false, code })
    const user = userEvent.setup()
    render(<EditPage />)

    await user.click(save())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
    expect(refresh).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("remounts on the latest task once the re-read after a stale save brings it, dropping what was typed", async () => {
    updateTaskAction.mockResolvedValue({ ok: false, code: "tasks.stale" })
    const user = userEvent.setup()
    const { rerender } = render(<EditPage />)

    await user.clear(screen.getByLabelText("Title"))
    await user.type(screen.getByLabelText("Title"), "My title")
    await user.click(save())
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.getByLabelText("Title")).toHaveValue("My title")

    // Another approver saved first: a new title, and SLOT_B removed.
    rerender(
      <EditPage
        task={{
          ...TASK,
          title: "Their title",
          slots: [TASK.slots[0], TASK.slots[2]],
          updatedAt: "2026-10-30T03:00:00.000001+00:00",
        }}
      />
    )

    expect(screen.getByLabelText("Title")).toHaveValue("Their title")
    expect(memberBoxes()).toHaveLength(2)
    expect(save()).toBeEnabled()
  })

  it.each([
    [
      "tasks.duplicate_slot",
      "The same member already has that role — remove one.",
    ],
    ["tasks.save_failed", "Couldn't save — try again."],
  ])(
    "toasts %s's copy and keeps what was typed, without re-reading",
    async (code, copy) => {
      updateTaskAction.mockResolvedValue({ ok: false, code })
      const user = userEvent.setup()
      render(<EditPage />)

      await user.clear(screen.getByLabelText("Title"))
      await user.type(screen.getByLabelText("Title"), "My title")
      await user.click(save())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
      expect(screen.getByLabelText("Title")).toHaveValue("My title")
      expect(save()).toBeEnabled()
    }
  )

  it("toasts the generic copy and keeps what was typed when the call itself fails", async () => {
    updateTaskAction.mockRejectedValue(new Error("network"))
    const user = userEvent.setup()
    render(<EditPage />)

    await user.clear(screen.getByLabelText("Title"))
    await user.type(screen.getByLabelText("Title"), "My title")
    await user.click(save())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Title")).toHaveValue("My title")
  })

  it("refuses a repeated role and member inline, as create does, keeping the values", async () => {
    const user = userEvent.setup()
    render(<EditPage />)

    await user.click(screen.getByRole("button", { name: "Add slot" }))
    await choose(
      user,
      screen.getByRole("combobox", { name: "Role" }),
      "Layout Artist"
    )
    await choose(user, memberBoxes()[3], "Staff Layout Artist")
    await user.click(save())

    expect(
      await screen.findByText(
        "The same member already has that role — remove one"
      )
    ).toBeInTheDocument()
    expect(updateTaskAction).not.toHaveBeenCalled()
    expect(memberBoxes()).toHaveLength(4)
    expect(memberBoxes()[3]).toHaveTextContent("Staff Layout Artist")
  })

  it("validates the fields as create does", async () => {
    const user = userEvent.setup()
    render(<EditPage />)

    await user.clear(screen.getByLabelText("Title"))
    await user.clear(screen.getByLabelText("Reference link"))
    await user.type(screen.getByLabelText("Reference link"), "not-a-url")
    await user.click(save())

    expect(await screen.findByText("Add a title")).toBeInTheDocument()
    expect(screen.getByText("Enter a valid link")).toBeInTheDocument()
    expect(updateTaskAction).not.toHaveBeenCalled()
  })

  it("removes an existing slot, keeping at least one", async () => {
    updateTaskAction.mockResolvedValue({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: false },
    })
    const user = userEvent.setup()
    render(<EditPage />)

    await user.click(screen.getByRole("button", { name: "Remove slot 2" }))
    await user.click(save())

    await waitFor(() => expect(updateTaskAction).toHaveBeenCalledOnce())
    expect(updateTaskAction.mock.calls[0][0].slots).toEqual([
      LOADED_SLOTS[0],
      LOADED_SLOTS[2],
    ])
  })

  it("keeps a slot's current member in its list after Show everyone is unchecked", async () => {
    updateTaskAction.mockResolvedValue({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: false },
    })
    const user = userEvent.setup()
    render(<EditPage />)

    // SLOT_B's member isn't on the Cartoonist desk list, so it opened on
    // everyone.
    const toggle = screen.getAllByRole("checkbox", { name: "Show everyone" })[1]
    await user.click(toggle)
    expect(toggle).not.toBeChecked()

    expect(memberBoxes()[1]).toHaveTextContent("Staff Layout Artist")
    await user.click(memberBoxes()[1])
    const names = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent)
    expect(names).toEqual(["Head Layout Artist", "Staff Layout Artist"])
    await user.keyboard("{Escape}")

    await user.click(save())
    await waitFor(() => expect(updateTaskAction).toHaveBeenCalledOnce())
    expect(updateTaskAction.mock.calls[0][0].slots[1]).toEqual(LOADED_SLOTS[1])
  })

  it("keeps a member picked from everyone in the list after Show everyone is unchecked", async () => {
    const user = userEvent.setup()
    render(<EditPage />)

    // SLOT_A opened on its desk list; pick someone from everyone, then
    // narrow the list again.
    const toggle = screen.getAllByRole("checkbox", { name: "Show everyone" })[0]
    await user.click(toggle)
    await choose(user, memberBoxes()[0], "Head Layout Artist")
    await user.click(toggle)

    expect(memberBoxes()[0]).toHaveTextContent("Head Layout Artist")
  })

  describe("on a Done task", () => {
    const DONE: TaskEdit = { ...TASK, done: true }

    it("shows every slot's role and member as read-only text, with no Add slot, Remove or Show everyone", () => {
      render(<EditPage task={DONE} />)

      expect(screen.queryAllByRole("combobox", { name: "Member" })).toEqual([])
      expect(screen.queryAllByRole("combobox", { name: "Role" })).toEqual([])
      expect(
        screen
          .getAllByRole("group", { name: "Member" })
          .map((group) => group.textContent)
      ).toEqual([
        "MemberStaff Layout Artist",
        "MemberStaff Layout Artist",
        "MemberFormer member",
      ])
      expect(screen.getAllByRole("group", { name: "Role" })).toHaveLength(3)
      expect(screen.queryByRole("button", { name: "Add slot" })).toBeNull()
      expect(screen.queryByRole("button", { name: /Remove slot/ })).toBeNull()
      expect(screen.queryByRole("checkbox")).toBeNull()
    })

    it("still edits the fields, and sends the slots as stored", async () => {
      updateTaskAction.mockResolvedValue({
        ok: true,
        data: { taskId: TASK_ID, newAssignee: false },
      })
      const user = userEvent.setup()
      render(<EditPage task={DONE} />)

      await user.clear(screen.getByLabelText("Title"))
      await user.type(screen.getByLabelText("Title"), "Done, renamed")
      await user.click(save())

      await waitFor(() => expect(updateTaskAction).toHaveBeenCalledOnce())
      expect(updateTaskAction.mock.calls[0][0]).toEqual({
        taskId: TASK_ID,
        title: "Done, renamed",
        description: "Two pages.",
        dueAt: "2026-10-31T23:30",
        referenceUrl: "https://example.com/brief",
        slots: LOADED_SLOTS,
      })
    })

    it("has no axe violations", async () => {
      const { container } = render(<EditPage task={DONE} />)
      expect(await axeViolations(container)).toEqual([])
    })
  })

  it("has no axe violations", async () => {
    const { container } = render(<EditPage />)
    expect(await axeViolations(container)).toEqual([])
  })
})
