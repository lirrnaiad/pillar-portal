"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import { phtInputToUtc } from "@/lib/time"

import type { TaskErrorCode } from "./errors"
import { taskCreateSchema } from "./schemas"

export type CreateTaskState =
  | { ok: true; data: { id: string } }
  | { ok: false; code: TaskErrorCode; params?: Record<string, unknown> }

// create_task raises these two as `raise exception ... message = '<code>'`;
// tasks.no_slots and tasks.invalid_slot_member are backstops the UI never
// reaches (src/features/tasks/errors.ts), so any other message — a raw
// database error, a network failure — maps to the generic code instead of
// leaking a raw error to the UI.
const KNOWN_ERROR_CODES: ReadonlySet<TaskErrorCode> = new Set([
  "auth.not_active",
  "tasks.not_admin",
])

// task_assignments' own unique(task_id, member_id, role) constraint, not a
// raised message: a caller that bypasses taskCreateSchema's duplicate-pair
// refine still gets a specific, actionable error instead of the generic one.
const UNIQUE_VIOLATION = "23505"

function mapError(error: { code?: string; message: string }): TaskErrorCode {
  if (error.code === UNIQUE_VIOLATION) return "tasks.duplicate_slot"
  return KNOWN_ERROR_CODES.has(error.message as TaskErrorCode)
    ? (error.message as TaskErrorCode)
    : "tasks.create_failed"
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
    return { ok: false, code: mapError(error) }
  }

  revalidatePath("/admin/tasks")
  return { ok: true, data: { id: data } }
}
