import "server-only"

import { createClient } from "@/lib/supabase/server"

import type { OwnerFilter, TaskOwnerOption } from "../board"
import type { TaskColumn } from "../status"
import {
  nameMap,
  ownerOptions,
  taskCardsQuery,
  toTaskCard,
  withOwnerFilter,
  type TaskCardData,
} from "./shared"

/**
 * The Board's owner filter choices: the task form's owner list. Reads
 * `sections` and `desks` directly (every active member may). Throws on any
 * query error.
 */
export async function getBoardOwners(): Promise<TaskOwnerOption[]> {
  const supabase = await createClient()

  const [sectionsResult, desksResult] = await Promise.all([
    supabase.from("sections").select("id, name").order("sort_order"),
    supabase.from("desks").select("id, name").order("sort_order"),
  ])
  if (sectionsResult.error) {
    throw new Error("getBoardOwners: reading sections failed", {
      cause: sectionsResult.error,
    })
  }
  if (desksResult.error) {
    throw new Error("getBoardOwners: reading desks failed", {
      cause: desksResult.error,
    })
  }

  return ownerOptions(sectionsResult.data ?? [], desksResult.data ?? [])
}

export type BoardCard = TaskCardData & {
  /**
   * Every column the viewer may put the card in, from task_capabilities and
   * nothing else (AD-4): its allowed_moves in enum order, then Done when its
   * can_review is true. allowed_moves never holds Done (move_task never
   * enters it), so Done stays last and only the approver of a For Review
   * card gets it.
   */
  moves: TaskColumn[]
}

/**
 * Every task the filter names, as cards ordered by due date then id. The
 * slots come embedded in the tasks query (a Board can hold hundreds of
 * tasks, too many for an `.in()` list); with no tasks it stops there,
 * otherwise task_capabilities (whose row gives each card its `moves`) and
 * the names from member_directory (never `members`) are read together. The
 * whole directory is read rather than an `.in()` of slot members: over the
 * years those ids could outgrow a URL, while the directory holds only active
 * members. Throws on any query error.
 */
export async function getBoard(filter: OwnerFilter): Promise<BoardCard[]> {
  const supabase = await createClient()

  const tasksResult = await withOwnerFilter(taskCardsQuery(supabase), filter)
  if (tasksResult.error) {
    throw new Error("getBoard: reading tasks failed", {
      cause: tasksResult.error,
    })
  }
  const tasks = tasksResult.data ?? []
  if (tasks.length === 0) return []

  const [capabilitiesResult, membersResult] = await Promise.all([
    supabase.rpc("task_capabilities", { ids: tasks.map((task) => task.id) }),
    supabase.from("member_directory").select("id, name"),
  ])
  if (capabilitiesResult.error) {
    throw new Error("getBoard: reading task_capabilities failed", {
      cause: capabilitiesResult.error,
    })
  }
  if (membersResult.error) {
    throw new Error("getBoard: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const capabilitiesByTask = new Map(
    (capabilitiesResult.data ?? []).map((row) => [row.task_id, row])
  )

  const now = new Date()
  return tasks.map((task) => {
    const capabilities = capabilitiesByTask.get(task.id)
    return {
      ...toTaskCard(task, task.task_assignments, nameById, now),
      // The one place can_review becomes the Done target.
      moves: [
        ...(capabilities?.allowed_moves ?? []),
        ...(capabilities?.can_review ? (["done"] as const) : []),
      ],
    }
  })
}
