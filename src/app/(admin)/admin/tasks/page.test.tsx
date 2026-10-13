import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getTaskFormOptions, TaskForm, requireAdmin } = vi.hoisted(() => ({
  getTaskFormOptions: vi.fn(),
  TaskForm: vi.fn(() => null),
  requireAdmin: vi.fn(),
}))

vi.mock("@/features/tasks", () => ({ getTaskFormOptions, TaskForm }))
vi.mock("../../require-admin", () => ({ requireAdmin }))

import AdminTasksPage from "./page"

const OPTIONS = {
  owners: [{ kind: "section" as const, id: "news", name: "News" }],
  slotMembersByRole: {},
  allMembers: [],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminTasksPage", () => {
  it("loads the slot options and renders TaskForm with them", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    getTaskFormOptions.mockResolvedValue(OPTIONS)

    const element = await AdminTasksPage()
    const wrapper = element.props.children[1]
    const rendered = wrapper.props.children

    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(rendered.type).toBe(TaskForm)
    expect(rendered.props).toEqual({ options: OPTIONS })
  })

  it("runs the admin check first and reads nothing when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminTasksPage()).rejects.toBe(redirectError)
    expect(getTaskFormOptions).not.toHaveBeenCalled()
  })
})
