import "server-only"

import { PRODUCTION_ROLE_LABELS, type ProductionRole } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

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
