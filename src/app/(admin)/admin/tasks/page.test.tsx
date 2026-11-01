import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getTaskFormOptions,
  getReviewQueue,
  getHandedBackQueue,
  getReassignOptions,
  TaskForm,
  ReviewQueue,
  HandedBackQueue,
  requireAdmin,
} = vi.hoisted(() => ({
  getTaskFormOptions: vi.fn(),
  getReviewQueue: vi.fn(),
  getHandedBackQueue: vi.fn(),
  getReassignOptions: vi.fn(),
  TaskForm: vi.fn(() => null),
  ReviewQueue: vi.fn(() => null),
  HandedBackQueue: vi.fn(() => null),
  requireAdmin: vi.fn(),
}))

vi.mock("@/features/tasks", () => ({
  getTaskFormOptions,
  getReviewQueue,
  getHandedBackQueue,
  getReassignOptions,
  TaskForm,
  ReviewQueue,
  HandedBackQueue,
}))
vi.mock("../../require-admin", () => ({ requireAdmin }))

import AdminTasksPage, { metadata } from "./page"

const OPTIONS = {
  owners: [{ kind: "section" as const, id: "news", name: "News" }],
  slotMembersByRole: {},
  allMembers: [],
}

const REASSIGN_OPTIONS = {
  slotMembersByRole: {},
  allMembers: [],
  roleLabels: {},
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

const HANDED_BACK = [
  {
    slotId: "00000000-0000-4000-8000-000000000051",
    slotUpdatedAt: "2026-11-02T02:15:42.123456+00:00",
    taskId: "00000000-0000-4000-8000-000000000042",
    taskTitle: "Draw the strip",
    dueAt: "2099-01-01T00:00:00+00:00",
    role: "cartoonist" as const,
    roleLabel: "Cartoonist",
    memberId: "00000000-0000-4000-8000-000000000061",
    memberName: "Editor-in-Chief",
    reason: null,
  },
]

type PageElement = ReactElement<{
  id?: string
  tabIndex?: number
  className?: string
  children?: unknown
  tasks?: unknown
  slots?: unknown
  focusTargetId?: string
  options?: unknown
}>

afterEach(() => {
  vi.clearAllMocks()
})

function mockReads({
  handedBack = HANDED_BACK as unknown[],
  queue = QUEUE as unknown[],
} = {}) {
  requireAdmin.mockResolvedValue({ role: "editorial_admin" })
  getHandedBackQueue.mockResolvedValue(handedBack)
  getReviewQueue.mockResolvedValue(queue)
  getTaskFormOptions.mockResolvedValue(OPTIONS)
  getReassignOptions.mockResolvedValue(REASSIGN_OPTIONS)
}

describe("AdminTasksPage", () => {
  it("is titled Tasks", () => {
    expect(metadata.title).toBe("Tasks · The Pillar Portal")
  })

  it("renders the h1, then Needs reassignment, then the review queue, then 'Create a task' and the form", async () => {
    mockReads()

    const page = (await AdminTasksPage()) as PageElement
    const [h1, handedBack, queue, h2, wrapper] = page.props
      .children as PageElement[]

    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Tasks")
    // Focusable like What's mine's h1: the target when a row leaves.
    expect(h1.props.id).toBeTruthy()
    expect(h1.props.tabIndex).toBe(-1)
    expect(h1.props.className).toContain("focus-visible:outline-2")

    expect(handedBack.type).toBe(HandedBackQueue)
    expect(handedBack.props).toEqual({
      slots: HANDED_BACK,
      options: REASSIGN_OPTIONS,
      focusTargetId: h1.props.id,
    })

    expect(queue.type).toBe(ReviewQueue)
    expect(queue.props).toEqual({ tasks: QUEUE, focusTargetId: h1.props.id })

    expect(h2.type).toBe("h2")
    expect(h2.props.children).toBe("Create a task")

    const form = wrapper.props.children as PageElement
    expect(form.type).toBe(TaskForm)
    expect(form.props).toEqual({ options: OPTIONS })
  })

  it("builds the picker's options from the form options already read, reading them once", async () => {
    mockReads()

    await AdminTasksPage()

    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(getReassignOptions).toHaveBeenCalledExactlyOnceWith(OPTIONS)
  })

  it("builds no picker options when nothing needs reassignment, and hands the queue none", async () => {
    mockReads({ handedBack: [] })

    const page = (await AdminTasksPage()) as PageElement
    const [, handedBack] = page.props.children as PageElement[]

    expect(getReassignOptions).not.toHaveBeenCalled()
    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(handedBack.type).toBe(HandedBackQueue)
    expect(handedBack.props).toEqual({
      slots: [],
      options: null,
      focusTargetId: "admin-tasks-heading",
    })
  })

  it("runs the admin check first, then reads both queues and the form options together", async () => {
    let releaseHandedBack: (value: unknown) => void = () => {}
    mockReads()
    getHandedBackQueue.mockReturnValue(
      new Promise((resolve) => (releaseHandedBack = resolve))
    )

    const rendering = AdminTasksPage()
    await vi.waitFor(() => expect(getTaskFormOptions).toHaveBeenCalledOnce())

    // Every read started while the Needs reassignment queue is still loading.
    expect(getHandedBackQueue).toHaveBeenCalledOnce()
    expect(getReviewQueue).toHaveBeenCalledOnce()
    const checkedAt = requireAdmin.mock.invocationCallOrder[0]!
    for (const read of [
      getHandedBackQueue,
      getReviewQueue,
      getTaskFormOptions,
    ]) {
      expect(read.mock.invocationCallOrder[0]).toBeGreaterThan(checkedAt)
    }
    // The picker's options wait for the queue: they're built only for rows.
    expect(getReassignOptions).not.toHaveBeenCalled()

    releaseHandedBack(HANDED_BACK)
    await expect(rendering).resolves.toBeTruthy()
    expect(getReassignOptions).toHaveBeenCalledOnce()
  })

  it("reads nothing when the admin check redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminTasksPage()).rejects.toBe(redirectError)
    expect(getHandedBackQueue).not.toHaveBeenCalled()
    expect(getReviewQueue).not.toHaveBeenCalled()
    expect(getTaskFormOptions).not.toHaveBeenCalled()
    expect(getReassignOptions).not.toHaveBeenCalled()
  })

  it.each([
    ["getHandedBackQueue", getHandedBackQueue],
    ["getReviewQueue", getReviewQueue],
    ["getTaskFormOptions", getTaskFormOptions],
    ["getReassignOptions", getReassignOptions],
  ])("lets a failed %s throw", async (name, read) => {
    const failure = new Error(`${name}: reading failed`)
    mockReads()
    read.mockRejectedValue(failure)

    await expect(AdminTasksPage()).rejects.toBe(failure)
  })
})
