import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import type { Enums } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"
import { formatInPht } from "@/lib/time"

import { memberStateOf, type MemberState } from "./account-state"
import { homeScopeOf, type HomeScope } from "./home-scope"
import { findLookAlike } from "./look-alike"
import { groupOfferedPositions, type PositionGroup } from "./position-groups"

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

/** A member awaiting approval, as /admin/members lists them. */
export type PendingMember = {
  id: string
  name: string
  email: string
  /** When their member row was created: their first sign-in (ISO 8601). */
  signedInAt: string
  /** `signedInAt` in PHT, e.g. "Tue, Oct 20, 2026 at 9:05 PM PHT". */
  signedInLabel: string
  /** The active member they may be a second account of, else null. */
  lookAlikeName: string | null
}

/** An active member on the read-only roster. */
export type RosterMember = {
  id: string
  name: string
  email: string
  /** Their positions' titles, the primary first, then in `sort_order`. */
  positionTitles: string[]
}

export type MemberApprovalsData = {
  pending: PendingMember[]
  roster: RosterMember[]
  positionGroups: PositionGroup[]
}

const SIGNED_IN_FORMAT = "EEE, MMM d, yyyy 'at' h:mm a 'PHT'"

/**
 * What /admin/members shows (Story 2.2), read through RLS as the admin (an
 * admin reads every `members` and `member_positions` row; anyone else would
 * get only their own): the members awaiting approval, oldest first; the
 * active roster by name; and the positions the picker offers, grouped.
 * Pending means role `pending` with neither `declined_at` nor
 * `deactivated_at`, active a role other than `pending` with neither, as in
 * `private.is_member_active`, so declined and deactivated members are in
 * neither list. Each pending member's look-alike is matched here against the
 * roster the page already shows, so it adds no query and sends no extra
 * member data: the page gets only the matched member's name. Throws on any
 * query error.
 */
export async function getMemberApprovals(): Promise<MemberApprovalsData> {
  const supabase = await createClient()

  const [pendingResult, activeResult, positionsResult] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, email, created_at")
      .eq("role", "pending")
      .is("declined_at", null)
      .is("deactivated_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("members")
      .select("id, name, email, member_positions(position, is_primary)")
      .neq("role", "pending")
      .is("declined_at", null)
      .is("deactivated_at", null)
      .order("name", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("positions")
      .select(
        "id, title, is_board, is_top_editor, heads_desk_id, heads_section_id, sort_order"
      )
      .order("sort_order", { ascending: true }),
  ])

  for (const [label, result] of [
    ["pending members", pendingResult],
    ["active members", activeResult],
    ["positions", positionsResult],
  ] as const) {
    if (result.error) {
      throw new Error(`getMemberApprovals: reading ${label} failed`, {
        cause: result.error,
      })
    }
  }

  const positions = new Map(
    (positionsResult.data ?? []).map((row) => [row.id, row])
  )

  const roster: RosterMember[] = (activeResult.data ?? []).map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    positionTitles: member.member_positions
      .flatMap((held) => {
        const position = positions.get(held.position)
        return position ? [{ ...position, isPrimary: held.is_primary }] : []
      })
      .toSorted(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          a.sort_order - b.sort_order
      )
      .map((position) => position.title),
  }))

  const pending: PendingMember[] = (pendingResult.data ?? []).map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    signedInAt: member.created_at,
    signedInLabel: formatInPht(member.created_at, SIGNED_IN_FORMAT),
    lookAlikeName: findLookAlike(member, roster)?.name ?? null,
  }))

  return {
    pending,
    roster,
    positionGroups: groupOfferedPositions(positionsResult.data ?? []),
  }
}

/**
 * Admin home's "Awaiting approval" count (Story 2.3): the members awaiting
 * approval, for an active editorial_admin. Anyone else, signed out included,
 * gets 0 without the count query. A failed query throws.
 */
export async function countPendingApprovalsForViewer(): Promise<number> {
  const member = await getCurrentMember()
  if (member?.state !== "active" || member.role !== "editorial_admin") return 0

  const supabase = await createClient()
  const { count, error } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("role", "pending")
    .is("declined_at", null)
    .is("deactivated_at", null)
  if (error) {
    throw new Error(
      "countPendingApprovalsForViewer: counting pending members failed",
      { cause: error }
    )
  }
  return count ?? 0
}
