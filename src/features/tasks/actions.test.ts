import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { rpc, createClient, revalidatePath, after, recordErrorEvent } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    createClient: vi.fn(),
    revalidatePath: vi.fn(),
    // Holds each scheduled callback; runAfter() runs them, as Next does once
    // the response is sent.
    after: vi.fn<(task: () => unknown) => void>(),
    recordErrorEvent: vi.fn(async () => {}),
  }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
// taskCreateSchema (via ./schemas) imports @/features/members for
// PRODUCTION_ROLE_LABELS, which pulls in the members slice's own
// supabase/server and env.client imports.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import {
  createTaskAction,
  handBackSlotAction,
  markDoneAction,
  moveTaskAction,
  reopenTaskAction,
  respondToSlotAction,
  sendBackTaskAction,
} from "./actions"

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

async function runAfter() {
  for (const [task] of after.mock.calls) await task()
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
      "tasks.not_approver": "Only the task's head or a top editor can do that.",
      "tasks.stale":
        "Something changed since you opened this. Review the latest and try again.",
    })
  })
})

describe("handBackSlotAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await handBackSlotAction({ slotId: "abc" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("rejects a reason over 280 characters", async () => {
    const result = await handBackSlotAction({
      slotId: SLOT_ID,
      reason: "x".repeat(281),
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends the trimmed reason to hand_back_slot, then revalidates the dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await handBackSlotAction({
      slotId: SLOT_ID,
      reason: "  Out sick  ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("hand_back_slot", {
      slot_id: SLOT_ID,
      reason: "Out sick",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout")
    expect(result).toEqual({ ok: true, data: { state: "needs_reassignment" } })
  })

  it("sends no reason when it is blank", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await handBackSlotAction({ slotId: SLOT_ID, reason: "   " })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("hand_back_slot", {
      slot_id: SLOT_ID,
    })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_allowed", "tasks.not_allowed"],
    ["something unexpected", "tasks.save_failed"],
  ])("maps the database error %s to %s without revalidating", async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } })

    const result = await handBackSlotAction({ slotId: SLOT_ID })

    expect(result).toEqual({ ok: false, code })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe.each([
  ["markDoneAction", markDoneAction, "mark_done", { column: "done" }],
  ["reopenTaskAction", reopenTaskAction, "reopen_task", { column: "doing" }],
] as const)("%s", (_name, action, rpcName, data) => {
  it("rejects invalid input without calling the database", async () => {
    const result = await action({ taskId: "abc" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it(`calls ${rpcName}, then revalidates the dashboard and returns the new column`, async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await action({ taskId: TASK_ID })

    expect(rpc).toHaveBeenCalledExactlyOnceWith(rpcName, { task_id: TASK_ID })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout")
    expect(result).toEqual({ ok: true, data })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.not_allowed", "tasks.save_failed"],
    ["fetch failed", "tasks.save_failed"],
  ])("maps the database error %s to %s without revalidating", async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } })

    const result = await action({ taskId: TASK_ID })

    expect(result).toEqual({ ok: false, code })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("sendBackTaskAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await sendBackTaskAction({ taskId: "abc", note: "Fix" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(["", "   ", "x".repeat(5001)])(
    "rejects the note %j without calling the database",
    async (note) => {
      const result = await sendBackTaskAction({ taskId: TASK_ID, note })

      expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
      expect(createClient).not.toHaveBeenCalled()
    }
  )

  it("sends the trimmed note to send_back_task, then revalidates the dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await sendBackTaskAction({
      taskId: TASK_ID,
      note: "  fix captions ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("send_back_task", {
      task_id: TASK_ID,
      note: "fix captions",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout")
    expect(result).toEqual({ ok: true, data: { column: "doing" } })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.invalid_note", "tasks.save_failed"],
    ["something unexpected", "tasks.save_failed"],
  ])("maps the database error %s to %s without revalidating", async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } })

    const result = await sendBackTaskAction({ taskId: TASK_ID, note: "Fix" })

    expect(result).toEqual({ ok: false, code })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("recording unexpected errors", () => {
  // A raw database error, as PostgREST returns it.
  const RAW = {
    code: "42501",
    message: "permission denied for function move_task",
    details: null,
    hint: null,
  }

  it.each([
    [
      "createTaskAction",
      () => createTaskAction(VALID_INPUT),
      { route: "action createTaskAction", entityType: "task" },
    ],
    [
      "respondToSlotAction",
      () => respondToSlotAction({ slotId: SLOT_ID, response: "on_it" }),
      {
        route: "action respondToSlotAction",
        entityType: "task_assignment",
        entityId: SLOT_ID,
      },
    ],
    [
      "handBackSlotAction",
      () => handBackSlotAction({ slotId: SLOT_ID }),
      {
        route: "action handBackSlotAction",
        entityType: "task_assignment",
        entityId: SLOT_ID,
      },
    ],
    [
      "moveTaskAction",
      () => moveTaskAction({ taskId: TASK_ID, toColumn: "doing" }),
      { route: "action moveTaskAction", entityType: "task", entityId: TASK_ID },
    ],
    [
      "markDoneAction",
      () => markDoneAction({ taskId: TASK_ID }),
      { route: "action markDoneAction", entityType: "task", entityId: TASK_ID },
    ],
    [
      "sendBackTaskAction",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "Fix" }),
      {
        route: "action sendBackTaskAction",
        entityType: "task",
        entityId: TASK_ID,
      },
    ],
    [
      "reopenTaskAction",
      () => reopenTaskAction({ taskId: TASK_ID }),
      { route: "action reopenTaskAction", entityType: "task", entityId: TASK_ID },
    ],
  ])(
    "%s records an unexpected error after the response, with its action and entity",
    async (_name, call, where) => {
      rpc.mockResolvedValue({ data: null, error: RAW })

      const result = await call()

      expect(result).toMatchObject({ ok: false })
      expect(recordErrorEvent).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()

      await runAfter()
      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(RAW, where)
    }
  )

  it.each(["tasks.no_slots", "tasks.invalid_slot_member"])(
    "records create_task's backstop code %s",
    async (message) => {
      const error = { code: "P0001", message }
      rpc.mockResolvedValue({ data: null, error })

      await createTaskAction(VALID_INPUT)
      await runAfter()

      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
        route: "action createTaskAction",
        entityType: "task",
      })
    }
  )

  it("records send_back_task's backstop code tasks.invalid_note", async () => {
    const error = { code: "P0001", message: "tasks.invalid_note" }
    rpc.mockResolvedValue({ data: null, error })

    await sendBackTaskAction({ taskId: TASK_ID, note: "Fix" })
    await runAfter()

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
      route: "action sendBackTaskAction",
      entityType: "task",
      entityId: TASK_ID,
    })
  })

  it.each([
    [
      "createTaskAction",
      () => createTaskAction(VALID_INPUT),
      "tasks.not_admin",
    ],
    [
      "respondToSlotAction",
      () => respondToSlotAction({ slotId: SLOT_ID, response: "on_it" }),
      "tasks.not_allowed",
    ],
    [
      "handBackSlotAction",
      () => handBackSlotAction({ slotId: SLOT_ID }),
      "tasks.not_found",
    ],
    [
      "moveTaskAction",
      () => moveTaskAction({ taskId: TASK_ID, toColumn: "doing" }),
      "auth.not_active",
    ],
    [
      "markDoneAction",
      () => markDoneAction({ taskId: TASK_ID }),
      "tasks.not_approver",
    ],
    [
      "sendBackTaskAction",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "Fix" }),
      "tasks.stale",
    ],
    [
      "reopenTaskAction",
      () => reopenTaskAction({ taskId: TASK_ID }),
      "tasks.not_found",
    ],
  ])("%s doesn't record a known code (%s)", async (_name, call, message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

    await call()

    expect(after).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("doesn't record task_assignments' duplicate pair (23505), which has its own copy", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    })

    await createTaskAction(VALID_INPUT)

    expect(after).not.toHaveBeenCalled()
  })

  it.each([
    ["createTaskAction", () => createTaskAction({ ...VALID_INPUT, title: "" })],
    [
      "createTaskAction (a due date that can't convert)",
      () => createTaskAction({ ...VALID_INPUT, dueAt: "2026-02-30T10:00" }),
    ],
    ["respondToSlotAction", () => respondToSlotAction({ slotId: "abc" })],
    ["handBackSlotAction", () => handBackSlotAction({ slotId: "abc" })],
    [
      "moveTaskAction",
      () => moveTaskAction({ taskId: TASK_ID, toColumn: "x" }),
    ],
    ["markDoneAction", () => markDoneAction({ taskId: "abc" })],
    [
      "sendBackTaskAction (a blank note)",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "  " }),
    ],
    ["reopenTaskAction", () => reopenTaskAction({ taskId: "abc" })],
  ])("%s doesn't record a parse failure", async (_name, call) => {
    await call()

    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("doesn't record a success", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await moveTaskAction({ taskId: TASK_ID, toColumn: "doing" })

    expect(after).not.toHaveBeenCalled()
  })
})
