import "server-only"

import { z } from "zod"

import { PRODUCTION_ROLE_LABELS, type ProductionRole } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import type { SlotState, TaskColumn } from "./status"

export type TaskOwnerOption = {
  kind: "section" | "desk"
  id: string
  name: string
}

export type SlotMemberOption = {
  id: string
  name: string
}

/** Every active member who can fill a slot of that production role. */
export type SlotMembersByRole = Partial<Record<ProductionRole, SlotMemberOption[]>>

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
    supabase.from("desks").select("id, name, production_role").order("sort_order"),
    supabase.from("member_directory").select("id, name, positions").order("name"),
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

  const owners: TaskOwnerOption[] = [
    ...sections.map((section) => ({
      kind: "section" as const,
      id: section.id,
      name: section.name,
    })),
    ...desks
      .filter((desk) => desk.id !== "writers")
      .map((desk) => ({ kind: "desk" as const, id: desk.id, name: desk.name })),
  ]

  const slotMembersByRole: SlotMembersByRole = {}
  const allMembers: SlotMemberOption[] = []

  for (const member of members) {
    if (member.id === null || member.name === null) continue
    const option: SlotMemberOption = { id: member.id, name: member.name }
    allMembers.push(option)

    const roles = new Set<ProductionRole>()
    for (const position of parsePositions(member.positions)) {
      const role = position.desk_id ? roleByDeskId.get(position.desk_id) : undefined
      if (role) roles.add(role)
    }
    for (const role of roles) {
      ;(slotMembersByRole[role] ??= []).push(option)
    }
  }

  return { owners, slotMembersByRole, allMembers, roleLabels: PRODUCTION_ROLE_LABELS }
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
