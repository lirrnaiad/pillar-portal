import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { rpc, createClient, revalidatePath } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/cache", () => ({ revalidatePath }))
// taskCreateSchema (via ./schemas) imports @/features/members for
// PRODUCTION_ROLE_LABELS, which pulls in the members slice's own
// supabase/server and env.client imports.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { createTaskAction, moveTaskAction, respondToSlotAction } from "./actions"

const MEMBER_ID = "00000000-0000-4000-8000-000000000001"

const VALID_INPUT = {
  title: "Lay out the spread",
  description: null,
  owningSectionId: "news",
  owningDeskId: null,
  dueAt: "2026-10-31T23:30",
  referenceUrl: null,
  slots: [{ role: "layout_artist", memberId: MEMBER_ID }],
}

beforeEach(() => {
  createClient.mockResolvedValue({ rpc })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("createTaskAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await createTaskAction({ ...VALID_INPUT, title: "" })

    expect(result).toEqual({ ok: false, code: "tasks.create_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("calls create_task with the PHT due date converted to a UTC instant, then revalidates and returns the new id", async () => {
    rpc.mockResolvedValue({ data: "task-1", error: null })

    const result = await createTaskAction(VALID_INPUT)

    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_task", {
      title: "Lay out the spread",
      description: null,
      owning_section_id: "news",
      owning_desk_id: null,
      due_at: "2026-10-31T15:30:00.000Z",
      reference_url: null,
      slots: [{ role: "layout_artist", member_id: MEMBER_ID }],
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/admin/tasks")
    expect(result).toEqual({ ok: true, data: { id: "task-1" } })
  })

  it.each(["auth.not_active", "tasks.not_admin"])(
    "maps the database's %s error straight through",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await createTaskAction(VALID_INPUT)

      expect(result).toEqual({ ok: false, code: message })
    }
  )

  it.each([
    "tasks.no_slots",
    "tasks.invalid_slot_member",
    "permission denied for function create_task",
  ])(
    "maps an unrecognized database error (%s) to the generic code",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await createTaskAction(VALID_INPUT)

      expect(result).toEqual({ ok: false, code: "tasks.create_failed" })
    }
  )

  it("maps task_assignments' unique-violation (23505) to tasks.duplicate_slot, not the generic code", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "task_assignments_task_id_member_id_role_key"',
      },
    })

    const result = await createTaskAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, code: "tasks.duplicate_slot" })
  })

  it("doesn't revalidate when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "tasks.not_admin" } })

    await createTaskAction(VALID_INPUT)

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

const SLOT_ID = "00000000-0000-4000-8000-000000000011"
const TASK_ID = "00000000-0000-4000-8000-000000000021"

describe("respondToSlotAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await respondToSlotAction({ slotId: "abc", response: "on_it" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("answers I'm on it without a reason, even if one is passed, then revalidates the dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "on_it",
      reason: "Ignored",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "on_it",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout")
    expect(result).toEqual({ ok: true, data: { state: "on_it" } })
  })

  it("sends the trimmed reason with needs_reassignment", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "  Exams all week  ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "needs_reassignment",
      reason: "Exams all week",
    })
    expect(result).toEqual({ ok: true, data: { state: "needs_reassignment" } })
  })

  it("sends no reason when it is blank", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "   ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "needs_reassignment",
    })
  })

  it("rejects a reason over 280 characters without calling the database", async () => {
    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "x".repeat(281),
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(["auth.not_active", "tasks.not_found", "tasks.not_allowed"])(
    "maps the database's %s error straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await respondToSlotAction({ slotId: SLOT_ID, response: "on_it" })

      expect(result).toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    "tasks.not_admin",
    'new row for relation "assignment_reasons" violates check constraint',
    "permission denied for function respond_to_slot",
  ])("maps any other error (%s) to tasks.save_failed", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { message } })

    const result = await respondToSlotAction({ slotId: SLOT_ID, response: "on_it" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
  })
})

describe("moveTaskAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await moveTaskAction({ taskId: TASK_ID, toColumn: "archived" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("calls move_task, then revalidates the dashboard and returns the new column", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await moveTaskAction({ taskId: TASK_ID, toColumn: "for_review" })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("move_task", {
      task_id: TASK_ID,
      to_column: "for_review",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout")
    expect(result).toEqual({ ok: true, data: { column: "for_review" } })
  })

  it.each(["auth.not_active", "tasks.not_found", "tasks.not_allowed"])(
    "maps the database's %s error straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await moveTaskAction({ taskId: TASK_ID, toColumn: "doing" })

      expect(result).toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("maps any other error to tasks.save_failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } })

    const result = await moveTaskAction({ taskId: TASK_ID, toColumn: "doing" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
  })
})

describe("error copy", () => {
  it("maps each code to its copy", async () => {
    const { TASK_ERROR_COPY } = await import("./errors")
    expect(TASK_ERROR_COPY).toEqual({
      "auth.not_active": "Sign in to do that.",
      "tasks.not_admin": "Only the Editorial Board can create tasks.",
      "tasks.duplicate_slot": "The same member already has that role — remove one.",
      "tasks.create_failed": "Couldn't create the task. Try again.",
      "tasks.not_found": "This task was deleted or the link is wrong.",
      "tasks.not_allowed": "Couldn't save — try again.",
      "tasks.save_failed": "Couldn't save — try again.",
    })
  })
})
