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

import type { TaskFormOptions } from "../queries"
import { TaskForm } from "./task-form"

const { createTaskAction, toastSuccess, toastError } = vi.hoisted(() => ({
  createTaskAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../actions", () => ({ createTaskAction }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))
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
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Task created"))

    // Reset: the title is cleared...
    await waitFor(() =>
      expect(screen.getByLabelText("Title")).toHaveValue("")
    )
    // ...but the owner survives the reset.
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveTextContent(
      "News"
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
      expect(toastError).toHaveBeenCalledWith("Couldn't create the task. Try again.")
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
