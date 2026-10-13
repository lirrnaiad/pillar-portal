// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getTaskDetail, TaskDetailView, requireActiveMember } = vi.hoisted(
  () => ({
    getTaskDetail: vi.fn(),
    TaskDetailView: vi.fn<(props: { task: unknown }) => React.ReactNode>(() => (
      <h1>Task detail view</h1>
    )),
    requireActiveMember: vi.fn(),
  })
)

vi.mock("@/features/tasks", () => ({ getTaskDetail, TaskDetailView }))
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

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

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
    const task = { id: TASK_ID, title: "Lay out the spread" }
    getTaskDetail.mockResolvedValue(task)

    await renderPage(TASK_ID)

    expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(TASK_ID)
    expect(TaskDetailView).toHaveBeenCalledOnce()
    expect(TaskDetailView.mock.calls[0][0]).toEqual({ task })
    expect(screen.getByText("Task detail view")).toBeInTheDocument()
  })

  it.each([TASK_ID, "abc"])(
    "shows the not-found copy and a link back to What's mine when there's no task for %j",
    async (id) => {
      getTaskDetail.mockResolvedValue(null)

      await renderPage(id)

      expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(id)
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "This task was deleted or the link is wrong.",
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("link", { name: "Back to What's mine" })
      ).toHaveAttribute("href", "/dashboard")
      expect(TaskDetailView).not.toHaveBeenCalled()
    }
  )

  it("has no axe violations in the not-found state", async () => {
    getTaskDetail.mockResolvedValue(null)

    // The page renders inside the member shell's <main>, which isn't here.
    const { container } = await renderPage("abc")

    expect(await axeViolations(container)).toEqual([])
  })
})
