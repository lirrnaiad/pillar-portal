// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getReassignOptions,
  getTaskDetail,
  TaskDetailView,
  TaskNotFound,
  requireActiveMember,
} = vi.hoisted(() => ({
  getReassignOptions: vi.fn(),
  getTaskDetail: vi.fn(),
  TaskDetailView: vi.fn<
    (props: { task: unknown; reassignOptions?: unknown }) => React.ReactNode
  >(() => <h1>Task detail view</h1>),
  // Its copy and link have their own tests (task-not-found.test.tsx).
  TaskNotFound: vi.fn(() => <h1>Task not found</h1>),
  requireActiveMember: vi.fn(),
}))

vi.mock("@/features/tasks", () => ({
  getReassignOptions,
  getTaskDetail,
  TaskDetailView,
  TaskNotFound,
}))
// The shared state check has its own tests (members' queries.test.ts).
vi.mock("@/features/members", () => ({ requireActiveMember }))

import TaskPage, { metadata } from "./page"

const TASK_ID = "00000000-0000-4000-8000-000000000021"

beforeEach(() => {
  requireActiveMember.mockResolvedValue({ state: "active" })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage(id: string) {
  return render(
    await TaskPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    })
  )
}

describe("TaskPage", () => {
  it("is titled Task", () => {
    expect(metadata.title).toBe("Task · The Pillar Portal")
  })

  it("runs the shared state check first and reads no task when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireActiveMember.mockRejectedValue(redirectError)

    await expect(
      TaskPage({
        params: Promise.resolve({ id: TASK_ID }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toBe(redirectError)
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it("loads the task by its id and renders TaskDetailView with it", async () => {
    const task = {
      id: TASK_ID,
      title: "Lay out the spread",
      canReassign: false,
    }
    getTaskDetail.mockResolvedValue(task)

    await renderPage(TASK_ID)

    expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(TASK_ID)
    expect(TaskDetailView).toHaveBeenCalledOnce()
    expect(TaskDetailView.mock.calls[0][0]).toStrictEqual({
      task,
      reassignOptions: undefined,
    })
    expect(screen.getByText("Task detail view")).toBeInTheDocument()
  })

  it("reads no reassign options when task_capabilities doesn't offer Reassign", async () => {
    getTaskDetail.mockResolvedValue({ id: TASK_ID, canReassign: false })

    await renderPage(TASK_ID)

    expect(getReassignOptions).not.toHaveBeenCalled()
    expect(TaskDetailView.mock.calls[0][0].reassignOptions).toBeUndefined()
  })

  it("reads the reassign options, after the task, only when it offers Reassign, and passes them on", async () => {
    const task = { id: TASK_ID, title: "Lay out the spread", canReassign: true }
    const reassignOptions = {
      slotMembersByRole: {},
      allMembers: [],
      roleLabels: {},
    }
    getTaskDetail.mockResolvedValue(task)
    getReassignOptions.mockResolvedValue(reassignOptions)

    await renderPage(TASK_ID)

    expect(getReassignOptions).toHaveBeenCalledExactlyOnceWith()
    expect(getTaskDetail.mock.invocationCallOrder[0]).toBeLessThan(
      getReassignOptions.mock.invocationCallOrder[0]
    )
    expect(TaskDetailView.mock.calls[0][0]).toStrictEqual({
      task,
      reassignOptions,
    })
  })

  it.each([TASK_ID, "abc"])(
    "shows the shared not-found block when there's no task for %j",
    async (id) => {
      getTaskDetail.mockResolvedValue(null)

      await renderPage(id)

      expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(id)
      expect(TaskNotFound).toHaveBeenCalledOnce()
      expect(
        screen.getByRole("heading", { level: 1, name: "Task not found" })
      ).toBeInTheDocument()
      expect(TaskDetailView).not.toHaveBeenCalled()
      expect(getReassignOptions).not.toHaveBeenCalled()
    }
  )

  // RLS hides a deleted task from every caller, so getTaskDetail reads no
  // row for it (queries.test.ts) and the page can't tell it from a bad link.
  it("shows the same not-found for a deleted task", async () => {
    getTaskDetail.mockResolvedValue(null)

    await renderPage(TASK_ID)

    expect(TaskNotFound).toHaveBeenCalledOnce()
    expect(TaskDetailView).not.toHaveBeenCalled()
  })
})
