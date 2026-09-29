import "server-only"

import type { Enums } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

import { homeScopeOf, type HomeScope } from "./home-scope"

export type MemberRole = Enums<"member_role">

export type CurrentMember = {
  id: string
  name: string
  role: MemberRole
}

/**
 * The signed-in caller's own `members` row, or null when nobody is signed in
 * (no valid claims, or no `sub`) or they have no row. The id comes from
 * `getClaims()`, which verifies the access token; role is read from the
 * table, never from the token (AD-5).
 *
 * A failed `members` query throws instead: an outage must not look like
 * being signed out.
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const supabase = await createClient()

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims()
  const memberId = claimsData?.claims.sub
  if (claimsError || !memberId) return null

  const { data: member, error } = await supabase
    .from("members")
    .select("id, name, role")
    .eq("id", memberId)
    .maybeSingle()
  if (error) {
    throw new Error("getCurrentMember: reading the members row failed", {
      cause: error,
    })
  }

  return member
}

/**
 * The Board's default owner filter for the caller, from their own
 * `member_positions` (RLS lets a member read their own rows) and the
 * `positions` each names. No `sub` means All. A failed query throws.
 */
export async function getMyHomeScope(): Promise<HomeScope> {
  const supabase = await createClient()

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims()
  const memberId = claimsData?.claims.sub
  if (claimsError || !memberId) return { kind: "all" }

  const { data, error } = await supabase
    .from("member_positions")
    .select("is_primary, positions(desk_id, heads_section_id)")
    .eq("member_id", memberId)
  if (error) {
    throw new Error("getMyHomeScope: reading member_positions failed", {
      cause: error,
    })
  }

  return homeScopeOf(
    data.map((row) => ({
      isPrimary: row.is_primary,
      deskId: row.positions?.desk_id ?? null,
      headsSectionId: row.positions?.heads_section_id ?? null,
    }))
  )
}
