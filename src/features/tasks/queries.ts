import "server-only"

import { z } from "zod"

import {
  initialsOf,
  PRODUCTION_ROLE_LABELS,
  WRITERS_DESK_ID,
  type ProductionRole,
} from "@/features/members"
import { createClient } from "@/lib/supabase/server"
import { phtMonthBounds } from "@/lib/time"

import type { CalendarTask } from "./calendar"
import type { OwnerFilter, TaskOwnerOption } from "./board"
import type { PlannerScope } from "./planner"
import { isTaskOverdue, type SlotState, type TaskColumn } from "./status"

export type { TaskOwnerOption }

/**
 * Every content section, then every desk but Writers (which owns no task):
 * the one owner list the task form and the Board's filter share.
 */
function ownerOptions(
  sections: { id: string; name: string }[],
  desks: { id: string; name: string }[]
): TaskOwnerOption[] {
  return [
    ...sections.map((section) => ({
      kind: "section" as const,
      id: section.id,
      name: section.name,
    })),
    ...desks
      .filter((desk) => desk.id !== WRITERS_DESK_ID)
      .map((desk) => ({ kind: "desk" as const, id: desk.id, name: desk.name })),
  ]
}

export type SlotMemberOption = {
  id: string
  name: string
}

/** Every active member who can fill a slot of that production role. */
export type SlotMembersByRole = Partial<
  Record<ProductionRole, SlotMemberOption[]>
>

export type TaskFormOptions = {
  /** Every content section, then every desk but Writers (never a task owner). */
  owners: TaskOwnerOption[]
  /** "members who hold a position on that role's desk" (Design Notes). */
  slotMembersByRole: SlotMembersByRole
  /** Every active member, for the slot picker's "Show everyone". */
  allMembers: SlotMemberOption[]
  /**
   * Display labels for every production role, resolved here (server-side)
   * from @/features/members and handed down as data: task-form.tsx is a
   * client component, and PRODUCTION_ROLE_LABELS is reachable only through
   * the members barrel, which also carries "server-only" code (queries.ts)
   * that can't reach the client bundle.
   */
  roleLabels: Record<ProductionRole, string>
}

type MemberDirectoryPosition = {
  position: string
  is_primary: boolean
  desk_id: string | null
}

// member_directory's `positions` column is jsonb; nothing about its shape is
// enforced by the database type generator, so this is a defensive parse
// rather than a cast.
function parsePositions(value: unknown): MemberDirectoryPosition[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is MemberDirectoryPosition =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { position?: unknown }).position === "string" &&
      (typeof (item as { desk_id?: unknown }).desk_id === "string" ||
        (item as { desk_id?: unknown }).desk_id === null)
  )
}

/**
 * Everything the admin task form's owner and slot-member selects need.
 *
 * Reads `sections` and `desks` directly (every active member may, per
 * core_org_reference_read) and `member_directory` for the people (never
 * `members`/`member_positions`, which this caller can't read). The Writers
 * desk is excluded from `owners` but kept in the role map: an article owned
 * by a content section still gets a Writer slot.
 */
export async function getTaskFormOptions(): Promise<TaskFormOptions> {
  const supabase = await createClient()

  const [sectionsResult, desksResult, membersResult] = await Promise.all([
    supabase.from("sections").select("id, name").order("sort_order"),
    supabase
      .from("desks")
      .select("id, name, production_role")
      .order("sort_order"),
    supabase
      .from("member_directory")
      .select("id, name, positions")
      .order("name"),
  ])

  if (sectionsResult.error) {
    throw new Error("getTaskFormOptions: reading sections failed", {
      cause: sectionsResult.error,
    })
  }
  if (desksResult.error) {
    throw new Error("getTaskFormOptions: reading desks failed", {
      cause: desksResult.error,
    })
  }
  if (membersResult.error) {
    throw new Error("getTaskFormOptions: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const sections = sectionsResult.data ?? []
  const desks = desksResult.data ?? []
  const members = membersResult.data ?? []

  const roleByDeskId = new Map<string, ProductionRole>(
    desks.map((desk) => [desk.id, desk.production_role])
  )

  const owners = ownerOptions(sections, desks)

  const slotMembersByRole: SlotMembersByRole = {}
  const allMembers: SlotMemberOption[] = []

  for (const member of members) {
    if (member.id === null || member.name === null) continue
    const option: SlotMemberOption = { id: member.id, name: member.name }
    allMembers.push(option)

    const roles = new Set<ProductionRole>()
    for (const position of parsePositions(member.positions)) {
      const role = position.desk_id
        ? roleByDeskId.get(position.desk_id)
        : undefined
      if (role) roles.add(role)
    }
    for (const role of roles) {
      ;(slotMembersByRole[role] ??= []).push(option)
    }
  }

  return {
    owners,
    slotMembersByRole,
    allMembers,
    roleLabels: PRODUCTION_ROLE_LABELS,
  }
}

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
  /** Slots in the order they were created. */
  slots: TaskDetailSlot[]
  /**
   * What this caller may do, straight from task_capabilities (AD-4): the
   * columns it may move the task to, in enum order, and the ids of the
   * slots it may answer. Nothing else decides which actions are offered.
   */
  allowedMoves: TaskColumn[]
  respondableSlotIds: string[]
  /** Resolved here for the same client-bundle reason as TaskFormOptions's. */
  roleLabels: Record<ProductionRole, string>
}

const FORMER_MEMBER = "Former member"

// A malformed id would make Postgres raise invalid_text_representation, so
// it never gets that far: it reads as "not found", like a missing task.
const taskIdSchema = z.uuid()

/**
 * Everything Task detail shows, read as the caller (RLS decides what that
 * is), or null when the id is malformed or names no task the caller can
 * read. Throws on any query error.
 *
 * The task (with its owner's name), its slots and task_capabilities are read
 * together; the slot members' names (from member_directory, never
 * `members`) and the readable reasons then follow, since they need the slot
 * rows.
 */
export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  if (!taskIdSchema.safeParse(id).success) return null

  const supabase = await createClient()

  const [taskResult, slotsResult, capabilitiesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, description, due_at, reference_url, column, sections(name), desks(name)"
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

  const memberIds = [...new Set(slots.map((slot) => slot.member_id))]
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

  const nameById = new Map<string, string>()
  for (const member of membersResult.data ?? []) {
    if (member.id !== null && member.name !== null) {
      nameById.set(member.id, member.name)
    }
  }
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
    roleLabels: PRODUCTION_ROLE_LABELS,
  }
}

export type TaskCardAssignee = {
  id: string
  name: string
  initials: string
}

/** Everything a task card shows, computed on the server. */
export type TaskCardData = {
  id: string
  title: string
  ownerName: string
  /** UTC ISO timestamp; shown in PHT. */
  dueAt: string
  column: TaskColumn
  overdue: boolean
  /** Any slot on the task, anyone's, is in that state. */
  hasAwaitingResponse: boolean
  hasNeedsReassignment: boolean
  /** Distinct slot members in slot order. */
  assignees: TaskCardAssignee[]
}

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

function byDueThenId(
  a: { dueAt: string; id: string },
  b: { dueAt: string; id: string }
) {
  const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  if (diff !== 0) return diff
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

type CardTask = {
  id: string
  title: string
  due_at: string
  column: TaskColumn
  sections: { name: string } | null
  desks: { name: string } | null
}

/** One task card's data, from the task, its slots (in slot order) and the names. */
function toTaskCard(
  task: CardTask,
  slots: { member_id: string; state: SlotState }[],
  nameById: Map<string, string>,
  now: Date
): TaskCardData {
  const seen = new Set<string>()
  const assignees: TaskCardAssignee[] = []
  for (const slot of slots) {
    if (seen.has(slot.member_id)) continue
    seen.add(slot.member_id)
    const name = nameById.get(slot.member_id) ?? FORMER_MEMBER
    assignees.push({ id: slot.member_id, name, initials: initialsOf(name) })
  }
  return {
    id: task.id,
    title: task.title,
    ownerName: task.sections?.name ?? task.desks?.name ?? "",
    dueAt: task.due_at,
    column: task.column,
    overdue: isTaskOverdue(task.due_at, task.column, now),
    hasAwaitingResponse: slots.some(
      (slot) => slot.state === "awaiting_response"
    ),
    hasNeedsReassignment: slots.some(
      (slot) => slot.state === "needs_reassignment"
    ),
    assignees,
  }
}

function nameMap(rows: { id: string | null; name: string | null }[]) {
  const nameById = new Map<string, string>()
  for (const member of rows) {
    if (member.id !== null && member.name !== null) {
      nameById.set(member.id, member.name)
    }
  }
  return nameById
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

export type BoardCard = TaskCardData & {
  /** From task_capabilities' allowed_moves (AD-4), in enum order. */
  allowedMoves: TaskColumn[]
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Tasks as card rows, the Board's and the Planner's one select: each with its
 * owner's name and its slots embedded in slot order (created_at, then id),
 * the tasks by due date then id.
 */
function taskCardsQuery(supabase: ServerClient) {
  return supabase
    .from("tasks")
    .select(
      "id, title, due_at, column, sections(name), desks(name), task_assignments(member_id, state)"
    )
    .order("due_at")
    .order("id")
    .order("created_at", { referencedTable: "task_assignments" })
    .order("id", { referencedTable: "task_assignments" })
}

type TaskCardsQuery = ReturnType<typeof taskCardsQuery>

/** Narrows a card query to the tasks an owner filter names. */
function withOwnerFilter(
  query: TaskCardsQuery,
  filter: OwnerFilter
): TaskCardsQuery {
  switch (filter.kind) {
    case "section":
      return query.eq("owning_section_id", filter.id)
    case "desk":
      return query.eq("owning_desk_id", filter.id)
    case "articles":
      return query.not("owning_section_id", "is", null)
    case "all":
      return query
  }
}

/**
 * Every task the filter names, as cards ordered by due date then id. The
 * slots come embedded in the tasks query (a Board can hold hundreds of
 * tasks, too many for an `.in()` list); with no tasks it stops there,
 * otherwise task_capabilities and the names from member_directory (never
 * `members`) are read together. The whole directory is read rather than an
 * `.in()` of slot members: over the years those ids could outgrow a URL,
 * while the directory holds only active members. Throws on any query error.
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
  const movesByTask = new Map(
    (capabilitiesResult.data ?? []).map((row) => [
      row.task_id,
      row.allowed_moves,
    ])
  )

  const now = new Date()
  return tasks.map((task) => ({
    ...toTaskCard(task, task.task_assignments, nameById, now),
    allowedMoves: movesByTask.get(task.id) ?? [],
  }))
}

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

/**
 * The few columns the calendar event needs, read as the caller. Null for a
 * malformed id, a task the caller can't read and any query error, so the
 * route answers all three the same way.
 */
export async function getTaskForCalendar(
  id: string
): Promise<CalendarTask | null> {
  if (!taskIdSchema.safeParse(id).success) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, due_at, reference_url")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    dueAt: data.due_at,
    referenceUrl: data.reference_url,
  }
}
