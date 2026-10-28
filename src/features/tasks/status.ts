import type { StatusFamily } from "@/components/status-badge"
import { Constants, type Enums } from "@/lib/supabase/database.types"

// Labels and status families for a task's column and a slot's state
// (EXPERIENCE.md › State machines). No imports from @/features/members, so
// client components can use this module.

export type TaskColumn = Enums<"task_column">
export type SlotState = Enums<"slot_state">

/** The task_column enum's members, in enum order (To Do first). */
export const TASK_COLUMNS = Constants.public.Enums.task_column

export const TASK_COLUMN_LABELS: Record<TaskColumn, string> = {
  to_do: "To Do",
  doing: "Doing",
  for_review: "For Review",
  done: "Done",
}

export const TASK_COLUMN_FAMILIES: Record<TaskColumn, StatusFamily> = {
  to_do: "neutral",
  doing: "progress",
  for_review: "progress",
  done: "positive",
}

/** The status a sent-back task shows in place of its column's. */
export const SENT_BACK_LABEL = "Sent back"

/**
 * A task's status wherever it shows: "Sent back" in the attention family
 * while its revision note stands (`sentBack`), otherwise its column's label
 * and family. Display only; it decides no action.
 */
export function taskStatus(
  column: TaskColumn,
  sentBack: boolean
): { family: StatusFamily; label: string } {
  if (sentBack) return { family: "attention", label: SENT_BACK_LABEL }
  return {
    family: TASK_COLUMN_FAMILIES[column],
    label: TASK_COLUMN_LABELS[column],
  }
}

export const SLOT_STATE_LABELS: Record<SlotState, string> = {
  awaiting_response: "Awaiting response",
  on_it: "On it",
  needs_reassignment: "Needs reassignment",
}

export const SLOT_STATE_FAMILIES: Record<SlotState, StatusFamily> = {
  awaiting_response: "neutral",
  on_it: "none",
  needs_reassignment: "attention",
}

/**
 * Overdue (EXPERIENCE.md › Terms): `due_at` is past and the task isn't Done.
 * Status display only; it decides no action.
 */
export function isTaskOverdue(
  dueAt: string,
  column: TaskColumn,
  now: Date = new Date()
): boolean {
  return column !== "done" && new Date(dueAt).getTime() < now.getTime()
}
