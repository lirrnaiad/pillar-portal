import "server-only"

import {
  getCurrentMember,
  PRODUCTION_ROLE_LABELS,
  type ProductionRole,
} from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import { FORMER_MEMBER, nameMap } from "./shared"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** One handed-back slot the viewer may reassign. */
export type HandedBackSlot = {
  slotId: string
  /**
   * The slot's version, `updated_at` exactly as PostgREST returned it, which
   * the reassign picker passes back (AD-21). Never parsed: a `Date` would
   * drop its microseconds.
   */
  slotUpdatedAt: string
  taskId: string
  taskTitle: string
  /** UTC ISO timestamp; shown in PHT. */
  dueAt: string
  role: ProductionRole
  /** Resolved here for the same client-bundle reason as TaskFormOptions's (./task-form.ts). */
  roleLabel: string
  /** Who handed it back: the slot keeps its member until it is reassigned. */
  memberId: string
  /** From member_directory; "Former member" when they're no longer listed. */
  memberName: string
  /**
   * The hand-back reason, when one was given (RLS shows it to the slot's
   * assignee and the task's approver).
   */
  reason: string | null
}

/**
 * The one read behind the Needs reassignment queue, Admin home's card and
 * the count: the tasks that aren't Done, each with only its
 * needs_reassignment slots embedded (`!inner`, so a task without one isn't
 * returned), both filters sent in the query; the tasks soonest due first,
 * then by id, their slots in slot order (created_at, then id). Each slot
 * embeds its reason (assignment_reasons is keyed by the slot, so one row or
 * none), which RLS shows only to the slot's assignee and the task's
 * approver; embedding it keeps slot ids out of a URL. Then
 * task_capabilities for their ids, keeping the tasks whose can_reassign is
 * true. Which ones those are is Postgres's answer alone (AD-4): a top editor
 * gets every one, a head their own section's or desk's. RLS already hides a
 * deleted task and its slots. `where` names the caller in its errors.
 * Throws on any query error.
 */
async function reassignableHandedBack(supabase: ServerClient, where: string) {
  const tasksResult = await supabase
    .from("tasks")
    .select(
      "id, title, due_at, task_assignments!inner(id, role, member_id, updated_at, assignment_reasons(reason))"
    )
    .eq("task_assignments.state", "needs_reassignment")
    .neq("column", "done")
    .order("due_at")
    .order("id")
    .order("created_at", { referencedTable: "task_assignments" })
    .order("id", { referencedTable: "task_assignments" })
  if (tasksResult.error) {
    throw new Error(`${where}: reading tasks failed`, {
      cause: tasksResult.error,
    })
  }
  const tasks = tasksResult.data ?? []
  if (tasks.length === 0) return []

  const capabilitiesResult = await supabase.rpc("task_capabilities", {
    ids: tasks.map((task) => task.id),
  })
  if (capabilitiesResult.error) {
    throw new Error(`${where}: reading task_capabilities failed`, {
      cause: capabilitiesResult.error,
    })
  }

  const reassignable = new Set(
    (capabilitiesResult.data ?? [])
      .filter((row) => row.can_reassign)
      .map((row) => row.task_id)
  )
  return tasks.filter((task) => reassignable.has(task.id))
}

/**
 * The read's rows, one per slot in its order, with the members' names from
 * member_directory (never `members`). The whole directory is read rather
 * than an `.in()` of slot members, as getReviewQueue does. With no task kept
 * it stops there. Throws on any query error.
 */
async function handedBackSlots(
  supabase: ServerClient,
  where: string
): Promise<HandedBackSlot[]> {
  const tasks = await reassignableHandedBack(supabase, where)
  if (tasks.length === 0) return []

  const membersResult = await supabase
    .from("member_directory")
    .select("id, name")
  if (membersResult.error) {
    throw new Error(`${where}: reading member_directory failed`, {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])

  return tasks.flatMap((task) =>
    task.task_assignments.map((slot) => ({
      slotId: slot.id,
      slotUpdatedAt: slot.updated_at,
      taskId: task.id,
      taskTitle: task.title,
      dueAt: task.due_at,
      role: slot.role,
      roleLabel: PRODUCTION_ROLE_LABELS[slot.role],
      memberId: slot.member_id,
      memberName: nameById.get(slot.member_id) ?? FORMER_MEMBER,
      reason: slot.assignment_reasons?.reason ?? null,
    }))
  )
}

/**
 * Only an active editorial_admin can be an approver; anyone else, signed out
 * included, needs no query.
 */
async function viewerMayApprove() {
  const member = await getCurrentMember()
  return member?.state === "active" && member.role === "editorial_admin"
}

/**
 * `/admin/tasks`' Needs reassignment queue: the handed-back slots the viewer
 * may reassign, soonest due first. The page's admin check comes first.
 * Throws on any query error.
 */
export async function getHandedBackQueue(): Promise<HandedBackSlot[]> {
  const supabase = await createClient()
  return handedBackSlots(supabase, "getHandedBackQueue")
}

/**
 * Admin home's Needs reassignment card: the same rows, for an active
 * editorial_admin; anyone else gets [] without a query. A failed query
 * throws.
 */
export async function getHandedBackForViewer(): Promise<HandedBackSlot[]> {
  if (!(await viewerMayApprove())) return []

  const supabase = await createClient()
  return handedBackSlots(supabase, "getHandedBackForViewer")
}

/**
 * The number of slots in the viewer's queue: the same read's length, for an
 * active editorial_admin; anyone else gets 0 without a query. A count needs
 * no names. A failed query throws.
 */
export async function countHandedBackForViewer(): Promise<number> {
  if (!(await viewerMayApprove())) return 0

  const supabase = await createClient()
  const tasks = await reassignableHandedBack(
    supabase,
    "countHandedBackForViewer"
  )
  return tasks.reduce((sum, task) => sum + task.task_assignments.length, 0)
}
