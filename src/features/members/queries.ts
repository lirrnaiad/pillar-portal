import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import type { Enums } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

import { memberStateOf, type MemberState } from "./account-state"
import { homeScopeOf, type HomeScope } from "./home-scope"

export type MemberRole = Enums<"member_role">

export type CurrentMember = {
  id: string
  name: string
  role: MemberRole
  state: MemberState
}

/** A CurrentMember who is active: the only kind past requireActiveMember. */
export type ActiveMember = CurrentMember & { state: "active" }

/**
 * The signed-in caller's own `members` row and account state, or null when
 * nobody is signed in (no valid claims, or no `sub`) or they have no row.
 * The id comes from `getClaims()`, which verifies the access token; role and
 * state are read from the table, never from the token (AD-5). RLS lets every
 * caller read their own row, whatever their state.
 *
 * A failed `members` query throws instead: an outage must not look like
 * being signed out. Cached per request, so a layout and its page share one
 * query.
 */
export const getCurrentMember = cache(
  async (): Promise<CurrentMember | null> => {
    const supabase = await createClient()

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims()
    const memberId = claimsData?.claims.sub
    if (claimsError || !memberId) return null

    const { data: member, error } = await supabase
      .from("members")
      .select("id, name, role, declined_at, deactivated_at")
      .eq("id", memberId)
      .maybeSingle()
    if (error) {
      throw new Error("getCurrentMember: reading the members row failed", {
        cause: error,
      })
    }
    if (!member) return null

    return {
      id: member.id,
      name: member.name,
      role: member.role,
      state: memberStateOf({
        role: member.role,
        declinedAt: member.declined_at,
        deactivatedAt: member.deactivated_at,
      }),
    }
  }
)

/**
 * The one state check every member and admin layout and page makes first:
 * the active caller, else a redirect to /login, which shows a pending,
 * declined or deactivated member their state and anyone else the sign-in
 * page. Pages check too, not only layouts: a layout doesn't stop its page
 * rendering and isn't re-run on client navigation. Routing only; RLS and the
 * commands decide access (AD-7).
 */
export async function requireActiveMember(): Promise<ActiveMember> {
  const member = await getCurrentMember()
  if (member?.state !== "active") redirect("/login")
  return member as ActiveMember
}

/**
 * The Board's default owner filter for the caller, from their own
 * `member_positions` (RLS lets an active member read their own rows) and the
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
