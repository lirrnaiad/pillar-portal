import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getTaskFormOptions, TaskForm } = vi.hoisted(() => ({
  getTaskFormOptions: vi.fn(),
  TaskForm: vi.fn(() => null),
}))

vi.mock("@/features/tasks", () => ({ getTaskFormOptions, TaskForm }))

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
    getTaskFormOptions.mockResolvedValue(OPTIONS)

    const element = await AdminTasksPage()
    const wrapper = element.props.children[1]
    const rendered = wrapper.props.children

    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(rendered.type).toBe(TaskForm)
    expect(rendered.props).toEqual({ options: OPTIONS })
  })
})
