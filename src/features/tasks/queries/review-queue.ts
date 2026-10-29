import "server-only"

import { getCurrentMember } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import {
  nameMap,
  taskCardsQuery,
  toTaskCard,
  type TaskCardData,
} from "./shared"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The review queue's one read, which the queue and Admin home's count share:
 * the For Review tasks as card rows (soonest due first, then id), then
 * task_capabilities for their ids, keeping the tasks whose can_review is
 * true. Which ones those are is Postgres's answer alone (AD-4): a top editor
 * gets every one, a head their own section's or desk's. `where` names the
 * caller in its errors. Throws on any query error.
 */
async function reviewableTasks(supabase: ServerClient, where: string) {
  const tasksResult = await taskCardsQuery(supabase).eq("column", "for_review")
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

  const reviewable = new Set(
    (capabilitiesResult.data ?? [])
      .filter((row) => row.can_review)
      .map((row) => row.task_id)
  )
  return tasks.filter((task) => reviewable.has(task.id))
}

/**
 * The tasks waiting for the viewer's review, as cards, soonest due first,
 * with the slot members' names from member_directory (never `members`). With
 * none reviewable it stops there. The whole directory is read rather than an
 * `.in()` of slot members, as getBoard does: a top editor's For Review
 * backlog could gather enough slot members to push those ids past a URL's
 * limit, while the directory holds only active members. Throws on any query
 * error.
 */
export async function getReviewQueue(): Promise<TaskCardData[]> {
  const supabase = await createClient()

  const tasks = await reviewableTasks(supabase, "getReviewQueue")
  if (tasks.length === 0) return []

  const membersResult = await supabase
    .from("member_directory")
    .select("id, name")
  if (membersResult.error) {
    throw new Error("getReviewQueue: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const now = new Date()
  return tasks.map((task) =>
    toTaskCard(task, task.task_assignments, nameById, now)
  )
}

/**
 * Admin home's "Waiting for your review" count: the length of the same read
 * the queue shows, for an active editorial_admin (only they can be an
 * approver). Anyone else, signed out included, gets 0 without a query. A
 * failed query throws.
 */
export async function countReviewQueueForViewer(): Promise<number> {
  const member = await getCurrentMember()
  if (member?.state !== "active" || member.role !== "editorial_admin") return 0

  const supabase = await createClient()
  const tasks = await reviewableTasks(supabase, "countReviewQueueForViewer")
  return tasks.length
}
