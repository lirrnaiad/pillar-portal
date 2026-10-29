import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getTaskFormOptions,
  getReviewQueue,
  TaskForm,
  ReviewQueue,
  requireAdmin,
} = vi.hoisted(() => ({
  getTaskFormOptions: vi.fn(),
  getReviewQueue: vi.fn(),
  TaskForm: vi.fn(() => null),
  ReviewQueue: vi.fn(() => null),
  requireAdmin: vi.fn(),
}))

vi.mock("@/features/tasks", () => ({
  getTaskFormOptions,
  getReviewQueue,
  TaskForm,
  ReviewQueue,
}))
vi.mock("../../require-admin", () => ({ requireAdmin }))

import AdminTasksPage, { metadata } from "./page"

const OPTIONS = {
  owners: [{ kind: "section" as const, id: "news", name: "News" }],
  slotMembersByRole: {},
  allMembers: [],
}

const QUEUE = [
  {
    id: "00000000-0000-4000-8000-000000000041",
    title: "Lay out the spread",
    ownerName: "Layout",
    dueAt: "2099-01-01T00:00:00+00:00",
    column: "for_review" as const,
    overdue: false,
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
  },
]

type PageElement = ReactElement<{
  id?: string
  tabIndex?: number
  className?: string
  children?: unknown
  tasks?: unknown
  focusTargetId?: string
  options?: unknown
}>

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminTasksPage", () => {
  it("is titled Tasks", () => {
    expect(metadata.title).toBe("Tasks · The Pillar Portal")
  })

  it("renders the h1, then the review queue, then 'Create a task' and the form", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    getReviewQueue.mockResolvedValue(QUEUE)
    getTaskFormOptions.mockResolvedValue(OPTIONS)

    const page = (await AdminTasksPage()) as PageElement
    const [h1, queue, h2, wrapper] = page.props.children as PageElement[]

    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Tasks")
    // Focusable like What's mine's h1: the target when a reviewed row leaves.
    expect(h1.props.id).toBeTruthy()
    expect(h1.props.tabIndex).toBe(-1)
    expect(h1.props.className).toContain("focus-visible:outline-2")

    expect(queue.type).toBe(ReviewQueue)
    expect(queue.props).toEqual({ tasks: QUEUE, focusTargetId: h1.props.id })

    expect(h2.type).toBe("h2")
    expect(h2.props.children).toBe("Create a task")

    const form = wrapper.props.children as PageElement
    expect(form.type).toBe(TaskForm)
    expect(form.props).toEqual({ options: OPTIONS })
  })

  it("runs the admin check first, then reads the queue and the form options together", async () => {
    let releaseQueue: (value: unknown) => void = () => {}
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    getReviewQueue.mockReturnValue(
      new Promise((resolve) => (releaseQueue = resolve))
    )
    getTaskFormOptions.mockResolvedValue(OPTIONS)

    const rendering = AdminTasksPage()
    await vi.waitFor(() => expect(getTaskFormOptions).toHaveBeenCalledOnce())

    // Both reads started while the queue is still loading.
    expect(getReviewQueue).toHaveBeenCalledOnce()
    const checkedAt = requireAdmin.mock.invocationCallOrder[0]!
    expect(getReviewQueue.mock.invocationCallOrder[0]).toBeGreaterThan(
      checkedAt
    )
    expect(getTaskFormOptions.mock.invocationCallOrder[0]).toBeGreaterThan(
      checkedAt
    )

    releaseQueue([])
    await expect(rendering).resolves.toBeTruthy()
  })

  it("reads nothing when the admin check redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminTasksPage()).rejects.toBe(redirectError)
    expect(getReviewQueue).not.toHaveBeenCalled()
    expect(getTaskFormOptions).not.toHaveBeenCalled()
  })

  it("lets a failed read throw", async () => {
    const failure = new Error("getReviewQueue: reading tasks failed")
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    getReviewQueue.mockRejectedValue(failure)
    getTaskFormOptions.mockResolvedValue(OPTIONS)

    await expect(AdminTasksPage()).rejects.toBe(failure)
  })
})
