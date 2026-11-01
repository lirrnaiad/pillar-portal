import "server-only"

import type { ProductionRole } from "@/features/members"
import { createClient } from "@/lib/supabase/server"
import { utcToPhtInput } from "@/lib/time"

import { FORMER_MEMBER, nameMap, taskIdSchema } from "./shared"

export type TaskEditSlot = {
  id: string
  role: ProductionRole
  memberId: string
  /**
   * From member_directory; "Former member" when they're no longer listed,
   * so the form can still name a member its pickers don't offer.
   */
  memberName: string
}

/** Everything the task form needs to open in edit mode. */
export type TaskEdit = {
  id: string
  title: string
  description: string | null
  /** The owning content section's or desk's name; the owner is fixed. */
  ownerName: string
  /** The due date as the form's datetime-local value, in PHT. */
  dueAtInput: string
  referenceUrl: string | null
  /** Slots in the order they were created. */
  slots: TaskEditSlot[]
  /**
   * The task is Done: update_task takes only its text then, so the form
   * shows its slots read-only.
   */
  done: boolean
  /**
   * Whether the caller may edit it (it is the task's approver), straight from
   * task_capabilities (AD-4).
   */
  canManage: boolean
  /**
   * The task's `updated_at`, exactly as PostgREST returned it. The edit page
   * keys the form on it, so a refresh that brings a newer task remounts it.
   */
  updatedAt: string
}

/**
 * The task as the edit form opens it, read as the caller (RLS decides what
 * that is), or null when the id is malformed or names no task the caller can
 * read (a deleted one included). Throws on any query error.
 *
 * The task (with its owner's name), its slots and task_capabilities are read
 * together; the slot members' names (from member_directory, never `members`)
 * then follow, since they need the slots.
 */
export async function getTaskEdit(id: string): Promise<TaskEdit | null> {
  if (!taskIdSchema.safeParse(id).success) return null

  const supabase = await createClient()

  const [taskResult, slotsResult, capabilitiesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, description, due_at, reference_url, column, updated_at, sections(name), desks(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("task_assignments")
      .select("id, member_id, role")
      .eq("task_id", id)
      .order("created_at")
      .order("id"),
    supabase.rpc("task_capabilities", { ids: [id] }),
  ])

  if (taskResult.error) {
    throw new Error("getTaskEdit: reading tasks failed", {
      cause: taskResult.error,
    })
  }
  if (slotsResult.error) {
    throw new Error("getTaskEdit: reading task_assignments failed", {
      cause: slotsResult.error,
    })
  }
  if (capabilitiesResult.error) {
    throw new Error("getTaskEdit: reading task_capabilities failed", {
      cause: capabilitiesResult.error,
    })
  }

  const task = taskResult.data
  if (!task) return null

  const slots = slotsResult.data ?? []
  const capabilities = (capabilitiesResult.data ?? []).find(
    (row) => row.task_id === task.id
  )

  const memberIds = [...new Set(slots.map((slot) => slot.member_id))]
  const membersResult =
    memberIds.length > 0
      ? await supabase
          .from("member_directory")
          .select("id, name")
          .in("id", memberIds)
      : { data: [], error: null }

  if (membersResult.error) {
    throw new Error("getTaskEdit: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    ownerName: task.sections?.name ?? task.desks?.name ?? "",
    dueAtInput: utcToPhtInput(task.due_at),
    referenceUrl: task.reference_url,
    slots: slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      memberId: slot.member_id,
      memberName: nameById.get(slot.member_id) ?? FORMER_MEMBER,
    })),
    done: task.column === "done",
    canManage: capabilities?.can_manage ?? false,
    updatedAt: task.updated_at,
  }
}
