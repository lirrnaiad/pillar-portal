import "server-only"

import { PRODUCTION_ROLE_LABELS } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import { byDueThenId, nameMap, toTaskCard, type TaskCardData } from "./shared"

export type WaitingSlot = {
  slotId: string
  roleLabel: string
  /** From task_capabilities' respondable_slot_ids, and nothing else. */
  respondable: boolean
  task: TaskCardData
}

export type WhatsMine = {
  /** The viewer's open awaiting slots, one per slot. */
  waiting: WaitingSlot[]
  /** Other tasks where the viewer holds an open slot, none also in waiting. */
  tasks: TaskCardData[]
}

/**
 * Everything What's mine shows. Which slots are open comes from
 * my_open_slots() (the one definition, in the database); nothing here
 * filters by state or column to decide that. Throws on any query error.
 *
 * With no open slot it stops there. Otherwise the tasks, every slot on them
 * and task_capabilities are read together, then the names from
 * member_directory (never `members`).
 */
export async function getWhatsMine(): Promise<WhatsMine> {
  const supabase = await createClient()

  const openResult = await supabase.rpc("my_open_slots")
  if (openResult.error) {
    throw new Error("getWhatsMine: reading my_open_slots failed", {
      cause: openResult.error,
    })
  }
  const openSlots = openResult.data ?? []
  if (openSlots.length === 0) return { waiting: [], tasks: [] }

  const taskIds = [...new Set(openSlots.map((slot) => slot.task_id))]

  const [tasksResult, slotsResult, capabilitiesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_at, column, sections(name), desks(name)")
      .in("id", taskIds),
    supabase
      .from("task_assignments")
      .select("id, task_id, member_id, state, created_at")
      .in("task_id", taskIds)
      .order("created_at")
      .order("id"),
    supabase.rpc("task_capabilities", { ids: taskIds }),
  ])

  if (tasksResult.error) {
    throw new Error("getWhatsMine: reading tasks failed", {
      cause: tasksResult.error,
    })
  }
  if (slotsResult.error) {
    throw new Error("getWhatsMine: reading task_assignments failed", {
      cause: slotsResult.error,
    })
  }
  if (capabilitiesResult.error) {
    throw new Error("getWhatsMine: reading task_capabilities failed", {
      cause: capabilitiesResult.error,
    })
  }

  const allSlots = slotsResult.data ?? []
  const memberIds = [...new Set(allSlots.map((slot) => slot.member_id))]
  const membersResult = await supabase
    .from("member_directory")
    .select("id, name")
    .in("id", memberIds)
  if (membersResult.error) {
    throw new Error("getWhatsMine: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])

  const respondable = new Set(
    (capabilitiesResult.data ?? []).flatMap((row) => row.respondable_slot_ids)
  )

  const slotsByTask = new Map<string, typeof allSlots>()
  for (const slot of allSlots) {
    const list = slotsByTask.get(slot.task_id) ?? []
    list.push(slot)
    slotsByTask.set(slot.task_id, list)
  }

  const now = new Date()
  const cards = new Map<string, TaskCardData>()
  for (const task of tasksResult.data ?? []) {
    cards.set(
      task.id,
      toTaskCard(task, slotsByTask.get(task.id) ?? [], nameById, now)
    )
  }

  const waiting: WaitingSlot[] = []
  const waitingTaskIds = new Set<string>()
  for (const slot of openSlots) {
    if (slot.state !== "awaiting_response") continue
    const task = cards.get(slot.task_id)
    if (!task) continue
    waitingTaskIds.add(task.id)
    waiting.push({
      slotId: slot.id,
      roleLabel: PRODUCTION_ROLE_LABELS[slot.role],
      respondable: respondable.has(slot.id),
      task,
    })
  }
  // Slots of one task keep the database's order (created_at, then id). A JS
  // Date would drop created_at's microseconds, and the slots one create_task
  // call inserts are often within the same millisecond.
  const slotRank = new Map(allSlots.map((slot, index) => [slot.id, index]))
  waiting.sort(
    (a, b) =>
      byDueThenId(a.task, b.task) ||
      (slotRank.get(a.slotId) ?? 0) - (slotRank.get(b.slotId) ?? 0)
  )

  const tasks = [...cards.values()]
    .filter((task) => !waitingTaskIds.has(task.id))
    .sort(byDueThenId)

  return { waiting, tasks }
}
