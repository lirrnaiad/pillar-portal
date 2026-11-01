// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getTaskEdit,
  getTaskFormOptions,
  TaskForm,
  formMounted,
  taskEditKey,
  TaskNotFound,
  requireAdmin,
  redirect,
} = vi.hoisted(() => ({
  getTaskEdit: vi.fn(),
  getTaskFormOptions: vi.fn(),
  // Counts its mounts (set up in beforeEach, once React is imported), so a
  // test sees whether a new key remounted it.
  TaskForm: vi.fn<(props: Record<string, unknown>) => React.ReactNode>(),
  formMounted: vi.fn(),
  // The real one has its own tests (task-edit-key.test.ts); here it only
  // has to say which key the page gives the form.
  taskEditKey: vi.fn<(task: unknown) => string>(),
  // Task detail's own block; its copy and link have their own tests
  // (task-not-found.test.tsx).
  TaskNotFound: vi.fn(() => <h1>Task not found</h1>),
  requireAdmin: vi.fn(),
  // Like Next's: it throws, so nothing after it renders.
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }),
}))

vi.mock("@/features/tasks", () => ({
  getTaskEdit,
  getTaskFormOptions,
  TaskForm,
  taskEditKey,
  TaskNotFound,
}))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("../../../../require-admin", () => ({ requireAdmin }))

import EditTaskPage, { metadata } from "./page"

const TASK_ID = "00000000-0000-4000-8000-000000000021"
const SLOT_A = "00000000-0000-4000-8000-000000000031"
const SLOT_B = "00000000-0000-4000-8000-000000000032"
const MEMBER = "00000000-0000-4000-8000-000000000001"

const OPTIONS = {
  owners: [],
  slotMembersByRole: {},
  allMembers: [],
  roleLabels: {},
}

const TASK = {
  id: TASK_ID,
  title: "Lay out the spread",
  description: null,
  ownerName: "Layout",
  dueAtInput: "2026-10-31T23:30",
  referenceUrl: null,
  slots: [
    {
      id: SLOT_A,
      role: "layout_artist",
      memberId: MEMBER,
      memberName: "Staff Layout Artist",
    },
    {
      id: SLOT_B,
      role: "cartoonist",
      memberId: MEMBER,
      memberName: "Staff Layout Artist",
    },
  ],
  canManage: true,
  updatedAt: "2026-10-30T02:15:42.123456+00:00",
}

function renderPage(id = TASK_ID) {
  return EditTaskPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  })
}

beforeEach(() => {
  requireAdmin.mockResolvedValue({ role: "editorial_admin" })
  getTaskFormOptions.mockResolvedValue(OPTIONS)
  taskEditKey.mockReturnValue("key-1")
  TaskForm.mockImplementation(function TaskFormMock() {
    useEffect(() => {
      formMounted()
    }, [])
    return <form aria-label="Task form" />
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("EditTaskPage", () => {
  it("is titled Edit task", () => {
    expect(metadata.title).toBe("Edit task · The Pillar Portal")
  })

  it("runs the admin check first, then reads the task and the form options together", async () => {
    let releaseTask: (value: unknown) => void = () => {}
    getTaskEdit.mockReturnValue(
      new Promise((resolve) => (releaseTask = resolve))
    )

    const rendering = renderPage()
    await vi.waitFor(() => expect(getTaskFormOptions).toHaveBeenCalledOnce())

    // Both reads started while the task is still loading.
    expect(getTaskEdit).toHaveBeenCalledExactlyOnceWith(TASK_ID)
    const checkedAt = requireAdmin.mock.invocationCallOrder[0]!
    expect(getTaskEdit.mock.invocationCallOrder[0]).toBeGreaterThan(checkedAt)
    expect(getTaskFormOptions.mock.invocationCallOrder[0]).toBeGreaterThan(
      checkedAt
    )

    releaseTask(TASK)
    await expect(rendering).resolves.toBeTruthy()
  })

  it("reads nothing when the admin check redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /dashboard")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(renderPage()).rejects.toBe(redirectError)
    expect(getTaskEdit).not.toHaveBeenCalled()
    expect(getTaskFormOptions).not.toHaveBeenCalled()
  })

  it("renders the h1 Edit task and the form in edit mode, keyed on the task's version and each slot's id and member", async () => {
    getTaskEdit.mockResolvedValue(TASK)

    render(await renderPage())

    expect(
      screen.getByRole("heading", { level: 1, name: "Edit task" })
    ).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "Task form" })).toBeInTheDocument()
    expect(TaskForm).toHaveBeenCalledOnce()
    expect(TaskForm.mock.calls[0][0]).toEqual({ options: OPTIONS, task: TASK })
  })

  it("keys the form with taskEditKey, so a re-read keeps it while the key holds and remounts it once the key changes", async () => {
    getTaskEdit.mockResolvedValue(TASK)

    const { rerender } = render(await renderPage())
    expect(taskEditKey).toHaveBeenCalledExactlyOnceWith(TASK)
    expect(formMounted).toHaveBeenCalledOnce()

    // A re-read of the same task: same key, same form.
    rerender(await renderPage())
    expect(formMounted).toHaveBeenCalledOnce()

    // A newer task: a new key, a fresh form.
    taskEditKey.mockReturnValue("key-2")
    rerender(await renderPage())
    expect(formMounted).toHaveBeenCalledTimes(2)
  })

  it.each([TASK_ID, "abc"])(
    "shows Task detail's not-found block when there's no task for %j",
    async (id) => {
      getTaskEdit.mockResolvedValue(null)

      render(await renderPage(id))

      expect(getTaskEdit).toHaveBeenCalledExactlyOnceWith(id)
      expect(TaskNotFound).toHaveBeenCalledOnce()
      expect(
        screen.getByRole("heading", { level: 1, name: "Task not found" })
      ).toBeInTheDocument()
      expect(TaskForm).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it("sends an admin who isn't the task's approver to its Task detail", async () => {
    getTaskEdit.mockResolvedValue({ ...TASK, canManage: false })

    await expect(renderPage()).rejects.toThrow(
      `NEXT_REDIRECT /dashboard/tasks/${TASK_ID}`
    )
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      `/dashboard/tasks/${TASK_ID}`
    )
    expect(TaskForm).not.toHaveBeenCalled()
  })

  it("lets a failed read throw", async () => {
    const failure = new Error("getTaskEdit: reading tasks failed")
    getTaskEdit.mockRejectedValue(failure)

    await expect(renderPage()).rejects.toBe(failure)
  })
})
