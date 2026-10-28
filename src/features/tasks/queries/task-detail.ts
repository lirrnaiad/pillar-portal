import "server-only"

import { PRODUCTION_ROLE_LABELS, type ProductionRole } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import type { SlotState, TaskColumn } from "../status"
import { FORMER_MEMBER, nameMap, taskIdSchema } from "./shared"

export type TaskDetailSlot = {
  id: string
  role: ProductionRole
  memberId: string
  /** From member_directory; "Former member" when they're no longer listed. */
  memberName: string
  state: SlotState
  /**
   * The hand-back reason, only when RLS lets the caller read it (the slot's
   * assignee or the task's approver) and the slot has one.
   */
  reason: string | null
}

/** The approver's note on a sent-back task, until its next column move. */
export type TaskRevisionNote = {
  text: string
  /** From member_directory; "Former member" when they're no longer listed. */
  byName: string
  /** UTC ISO timestamp; shown in PHT. */
  at: string
}

export type TaskDetail = {
  id: string
  title: string
  description: string | null
  /** The owning content section's or desk's name. */
  ownerName: string
  /** UTC ISO timestamp; shown in PHT. */
  dueAt: string
  referenceUrl: string | null
  column: TaskColumn
  /** Present while the task stands sent back; its status reads "Sent back". */
  revisionNote: TaskRevisionNote | null
  /** Slots in the order they were created. */
  slots: TaskDetailSlot[]
  /**
   * What this caller may do, straight from task_capabilities (AD-4): the
   * columns it may move the task to, in enum order, and the ids of the
   * slots it may answer. Nothing else decides which actions are offered.
   */
  allowedMoves: TaskColumn[]
  respondableSlotIds: string[]
  /** The slots it may hand back (On it, its own), from task_capabilities. */
  handBackSlotIds: string[]
  /**
   * Whether it may Mark done or Send back (For Review, and it is the
   * approver) and Reopen (Done, and it is the approver), from
   * task_capabilities.
   */
  canReview: boolean
  canReopen: boolean
  /** Resolved here for the same client-bundle reason as TaskFormOptions's (./task-form.ts). */
  roleLabels: Record<ProductionRole, string>
}

/**
 * Everything Task detail shows, read as the caller (RLS decides what that
 * is), or null when the id is malformed or names no task the caller can
 * read. Throws on any query error.
 *
 * The task (with its owner's name and any revision note), its slots and
 * task_capabilities are read together; the names of the slot members and the
 * note's author (from member_directory, never `members`) and the readable
 * reasons then follow, since they need those rows.
 */
export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  if (!taskIdSchema.safeParse(id).success) return null

  const supabase = await createClient()

  const [taskResult, slotsResult, capabilitiesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, description, due_at, reference_url, column, revision_note, revision_note_by, revision_note_at, sections(name), desks(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("task_assignments")
      .select("id, member_id, role, state")
      .eq("task_id", id)
      .order("created_at")
      .order("id"),
    supabase.rpc("task_capabilities", { ids: [id] }),
  ])

  if (taskResult.error) {
    throw new Error("getTaskDetail: reading tasks failed", {
      cause: taskResult.error,
    })
  }
  if (slotsResult.error) {
    throw new Error("getTaskDetail: reading task_assignments failed", {
      cause: slotsResult.error,
    })
  }
  if (capabilitiesResult.error) {
    throw new Error("getTaskDetail: reading task_capabilities failed", {
      cause: capabilitiesResult.error,
    })
  }

  const task = taskResult.data
  if (!task) return null

  const slots = slotsResult.data ?? []
  const capabilities = (capabilitiesResult.data ?? []).find(
    (row) => row.task_id === task.id
  )

  const memberIds = [
    ...new Set([
      ...slots.map((slot) => slot.member_id),
      ...(task.revision_note_by !== null ? [task.revision_note_by] : []),
    ]),
  ]
  const slotIds = slots.map((slot) => slot.id)

  const [membersResult, reasonsResult] = await Promise.all([
    memberIds.length > 0
      ? supabase.from("member_directory").select("id, name").in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    slotIds.length > 0
      ? supabase
          .from("assignment_reasons")
          .select("assignment_id, reason")
          .in("assignment_id", slotIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (membersResult.error) {
    throw new Error("getTaskDetail: reading member_directory failed", {
      cause: membersResult.error,
    })
  }
  if (reasonsResult.error) {
    throw new Error("getTaskDetail: reading assignment_reasons failed", {
      cause: reasonsResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const reasonBySlotId = new Map<string, string>(
    (reasonsResult.data ?? []).map((row) => [row.assignment_id, row.reason])
  )

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    ownerName: task.sections?.name ?? task.desks?.name ?? "",
    dueAt: task.due_at,
    referenceUrl: task.reference_url,
    column: task.column,
    revisionNote:
      task.revision_note !== null && task.revision_note_at !== null
        ? {
            text: task.revision_note,
            byName:
              (task.revision_note_by !== null
                ? nameById.get(task.revision_note_by)
                : undefined) ?? FORMER_MEMBER,
            at: task.revision_note_at,
          }
        : null,
    slots: slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      memberId: slot.member_id,
      memberName: nameById.get(slot.member_id) ?? FORMER_MEMBER,
      state: slot.state,
      reason: reasonBySlotId.get(slot.id) ?? null,
    })),
    allowedMoves: capabilities?.allowed_moves ?? [],
    respondableSlotIds: capabilities?.respondable_slot_ids ?? [],
    handBackSlotIds: capabilities?.hand_back_slot_ids ?? [],
    canReview: capabilities?.can_review ?? false,
    canReopen: capabilities?.can_reopen ?? false,
    roleLabels: PRODUCTION_ROLE_LABELS,
  }
}
