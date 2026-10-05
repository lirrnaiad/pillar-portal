"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import { phtInputToUtc } from "@/lib/time"

import type { TaskErrorCode } from "./errors"
import {
  slotHandBackSchema,
  slotRespondSchema,
  taskCreateSchema,
  taskMoveSchema,
} from "./schemas"
import type { SlotState, TaskColumn } from "./status"

// AD-3's result shape, shared by every action in the slice.
type ActionError = { ok: false; code: TaskErrorCode; params?: Record<string, unknown> }

export type CreateTaskState = { ok: true; data: { id: string } } | ActionError

export type RespondToSlotState =
  | { ok: true; data: { state: SlotState } }
  | ActionError

export type HandBackSlotState =
  | { ok: true; data: { state: "needs_reassignment" } }
  | ActionError

export type MoveTaskState =
  | { ok: true; data: { column: TaskColumn } }
  | ActionError

// The codes each command raises as `raise exception ... message = '<code>'`
// and the UI has copy for. Any other message — a code the UI never expects
// (create_task's tasks.no_slots and tasks.invalid_slot_member backstops), a
// raw database error, a network failure — maps to that action's generic code
// instead of leaking a raw error to the UI.
const CREATE_ERROR_CODES: ReadonlySet<TaskErrorCode> = new Set([
  "auth.not_active",
  "tasks.not_admin",
])

const COMMAND_ERROR_CODES: ReadonlySet<TaskErrorCode> = new Set([
  "auth.not_active",
  "tasks.not_found",
  "tasks.not_allowed",
])

// task_assignments' own unique(task_id, member_id, role) constraint, not a
// raised message: a caller that bypasses taskCreateSchema's duplicate-pair
// refine still gets a specific, actionable error instead of the generic one.
const UNIQUE_VIOLATION = "23505"

function mapError(
  error: { message: string },
  known: ReadonlySet<TaskErrorCode>,
  fallback: TaskErrorCode
): TaskErrorCode {
  const code = error.message as TaskErrorCode
  return known.has(code) ? code : fallback
}

/**
 * Creates a task (AD-3, AD-4): Zod-parses the task form's data, calls the one
 * command that may write tasks/task_assignments/activity, maps any error to
 * copy the UI can show, then revalidates /admin/tasks. `input` is `unknown`
 * because this is reachable directly, not only through the form that already
 * validated it with the same schema.
 */
export async function createTaskAction(input: unknown): Promise<CreateTaskState> {
  const parsed = taskCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: "tasks.create_failed" }
  }

  let dueAt: Date
  try {
    dueAt = phtInputToUtc(parsed.data.dueAt)
  } catch {
    return { ok: false, code: "tasks.create_failed" }
  }

  const supabase = await createClient()
  // The generated Args type doesn't mark owning_section_id, owning_desk_id,
  // description or reference_url nullable (the generator can't see that a
  // plpgsql parameter's SQL type allows null), though create_task's own body
  // treats a null in any of them as meaningful. The cast reflects what the
  // database actually accepts.
  const args = {
    title: parsed.data.title,
    description: parsed.data.description,
    owning_section_id: parsed.data.owningSectionId,
    owning_desk_id: parsed.data.owningDeskId,
    due_at: dueAt.toISOString(),
    reference_url: parsed.data.referenceUrl,
    slots: parsed.data.slots.map((slot) => ({
      role: slot.role,
      member_id: slot.memberId,
    })),
  } as Database["public"]["Functions"]["create_task"]["Args"]

  const { data, error } = await supabase.rpc("create_task", args)

  if (error) {
    return {
      ok: false,
      code:
        error.code === UNIQUE_VIOLATION
          ? "tasks.duplicate_slot"
          : mapError(error, CREATE_ERROR_CODES, "tasks.create_failed"),
    }
  }

  revalidatePath("/admin/tasks")
  return { ok: true, data: { id: data } }
}

/**
 * Answers the caller's own awaiting slot (AD-3, AD-4): I'm on it, or Can't
 * take this with an optional reason. respond_to_slot decides whether the
 * caller may; this only parses, calls it, maps the error and revalidates.
 * The reason is sent only with `needs_reassignment`.
 */
export async function respondToSlotAction(
  input: unknown
): Promise<RespondToSlotState> {
  const parsed = slotRespondSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: "tasks.save_failed" }
  }
  const { slotId, response, reason } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_to_slot", {
    slot_id: slotId,
    response,
    ...(response === "needs_reassignment" && reason !== null ? { reason } : {}),
  })

  if (error) {
    return {
      ok: false,
      code: mapError(error, COMMAND_ERROR_CODES, "tasks.save_failed"),
    }
  }

  revalidatePath("/dashboard", "layout")
  return { ok: true, data: { state: response } }
}

/**
 * Hands the caller's own On it slot back (AD-3, AD-4), with an optional
 * reason. hand_back_slot decides whether the caller may; this only parses,
 * calls it, maps the error and revalidates.
 */
export async function handBackSlotAction(
  input: unknown
): Promise<HandBackSlotState> {
  const parsed = slotHandBackSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: "tasks.save_failed" }
  }
  const { slotId, reason } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("hand_back_slot", {
    slot_id: slotId,
    ...(reason !== null ? { reason } : {}),
  })

  if (error) {
    return {
      ok: false,
      code: mapError(error, COMMAND_ERROR_CODES, "tasks.save_failed"),
    }
  }

  revalidatePath("/dashboard", "layout")
  return { ok: true, data: { state: "needs_reassignment" } }
}

/**
 * Moves a task to another column (AD-3, AD-4). move_task decides whether the
 * caller may; this only parses, calls it, maps the error and revalidates.
 */
export async function moveTaskAction(input: unknown): Promise<MoveTaskState> {
  const parsed = taskMoveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: "tasks.save_failed" }
  }
  const { taskId, toColumn } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("move_task", {
    task_id: taskId,
    to_column: toColumn,
  })

  if (error) {
    return {
      ok: false,
      code: mapError(error, COMMAND_ERROR_CODES, "tasks.save_failed"),
    }
  }

  revalidatePath("/dashboard", "layout")
  return { ok: true, data: { column: toColumn } }
}
