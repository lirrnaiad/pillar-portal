import "server-only"

import type { ProductionRole } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

import type { ReassignMember } from "../reassign"
import { getTaskFormOptions, type TaskFormOptions } from "./task-form"

/** Everything the reassign picker lists, each member with their load. */
export type ReassignOptions = {
  /** The members on each role's desk, as the task form groups them. */
  slotMembersByRole: Partial<Record<ProductionRole, ReassignMember[]>>
  /** Every active member, for Show everyone. */
  allMembers: ReassignMember[]
  /** Resolved here for the same client-bundle reason as TaskFormOptions's (./task-form.ts). */
  roleLabels: Record<ProductionRole, string>
}

/**
 * The picker's members: getTaskFormOptions()'s desk lists, everyone and the
 * role labels, each member with their open slots from
 * member_open_slot_counts() (the one open-slot definition, read as the
 * caller), 0 for a member it has no row for. A caller that has already read
 * the form options (`/admin/tasks`, for its task form) passes them in, and
 * only the counts are read. Throws on any query error.
 */
export async function getReassignOptions(
  formOptions?: TaskFormOptions
): Promise<ReassignOptions> {
  const supabase = await createClient()

  const [options, countsResult] = await Promise.all([
    formOptions ?? getTaskFormOptions(),
    supabase.rpc("member_open_slot_counts"),
  ])

  if (countsResult.error) {
    throw new Error(
      "getReassignOptions: reading member_open_slot_counts failed",
      {
        cause: countsResult.error,
      }
    )
  }

  const openSlotsById = new Map<string, number>(
    (countsResult.data ?? []).map((row) => [row.member_id, row.open_slots])
  )
  const withLoad = (member: { id: string; name: string }): ReassignMember => ({
    id: member.id,
    name: member.name,
    openSlots: openSlotsById.get(member.id) ?? 0,
  })

  const slotMembersByRole: ReassignOptions["slotMembersByRole"] = {}
  for (const [role, members] of Object.entries(options.slotMembersByRole)) {
    slotMembersByRole[role as ProductionRole] = (members ?? []).map(withLoad)
  }

  return {
    slotMembersByRole,
    allMembers: options.allMembers.map(withLoad),
    roleLabels: options.roleLabels,
  }
}
