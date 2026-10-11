import "server-only"

import { createClient } from "@/lib/supabase/server"
import { phtMonthBounds } from "@/lib/time"

import type { PlannerScope } from "../planner"
import {
  byDueThenId,
  nameMap,
  taskCardsQuery,
  toTaskCard,
  withOwnerFilter,
  type TaskCardData,
} from "./shared"

/**
 * The Planner's month (`YYYY-MM`, a Manila month): the tasks where the
 * viewer holds an open slot, plus, when `scope` is given, every task that
 * scope owns (Done included), each due inside the month and shown once,
 * ordered by due date then id. Which slots are open comes from
 * my_open_slots() alone, so the viewer's Done and handed-back tasks drop off
 * unless the scope brings them back.
 *
 * The two task reads share the Board's select and ordering and the month
 * window. The scope's needs nothing from my_open_slots, so it runs alongside
 * it; mine follows, as an `.in()` of task ids, which is fine here: a
 * member's open slots are few, unlike the Board's tasks. With no
 * tasks it stops there; otherwise the names come from the whole
 * member_directory (never `members`), as on the Board. No
 * task_capabilities: the Planner moves nothing. Throws on any query error.
 */
export async function getPlanner(
  month: string,
  scope: PlannerScope | null
): Promise<TaskCardData[]> {
  const { start, end } = phtMonthBounds(month)
  const supabase = await createClient()

  const monthTasks = () =>
    taskCardsQuery(supabase)
      .gte("due_at", start.toISOString())
      .lt("due_at", end.toISOString())
  const none = { data: [], error: null }

  const [openResult, scopeResult] = await Promise.all([
    supabase.rpc("my_open_slots"),
    scope ? withOwnerFilter(monthTasks(), scope) : none,
  ])
  if (openResult.error) {
    throw new Error("getPlanner: reading my_open_slots failed", {
      cause: openResult.error,
    })
  }
  const myTaskIds = [
    ...new Set((openResult.data ?? []).map((slot) => slot.task_id)),
  ]

  const mineResult =
    myTaskIds.length > 0 ? await monthTasks().in("id", myTaskIds) : none
  if (mineResult.error) {
    throw new Error("getPlanner: reading my tasks failed", {
      cause: mineResult.error,
    })
  }
  if (scopeResult.error) {
    throw new Error("getPlanner: reading the scope's tasks failed", {
      cause: scopeResult.error,
    })
  }

  const tasks = new Map(
    [...(mineResult.data ?? []), ...(scopeResult.data ?? [])].map((task) => [
      task.id,
      task,
    ])
  )
  if (tasks.size === 0) return []

  const membersResult = await supabase
    .from("member_directory")
    .select("id, name")
  if (membersResult.error) {
    throw new Error("getPlanner: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const now = new Date()
  return [...tasks.values()]
    .map((task) => toTaskCard(task, task.task_assignments, nameById, now))
    .sort(byDueThenId)
}
