// A member's account state, read from their own `members` row (never from
// the token). No runtime imports (only the generated role type): pure, so
// client and server code can both use it.
//
// It mirrors `private.is_member_active` (the database's one definition of
// active): a role other than `pending`, with neither `declined_at` nor
// `deactivated_at` set. Routing uses it; RLS and the commands still decide
// what anyone can read or do.

import type { Enums } from "@/lib/supabase/database.types"

export type MemberState = "active" | "pending" | "declined" | "deactivated"

/** Every state but active: the ones /login shows instead of the portal. */
export type InactiveMemberState = Exclude<MemberState, "active">

/**
 * The state, by precedence: deactivated, then declined, then pending, else
 * active. (Only a pending member can be declined; the database checks it.)
 */
export function memberStateOf({
  role,
  declinedAt,
  deactivatedAt,
}: {
  role: Enums<"member_role">
  declinedAt: string | null
  deactivatedAt: string | null
}): MemberState {
  if (deactivatedAt !== null) return "deactivated"
  if (declinedAt !== null) return "declined"
  if (role === "pending") return "pending"
  return "active"
}

/** What /login shows for each state but active (EXPERIENCE.md, UX-DR52). */
export const ACCOUNT_STATE_COPY = {
  pending: {
    title: "Awaiting approval",
    text: "You're signed in — a Board member will approve you shortly. Tell your editor or head you've joined.",
  },
  declined: {
    title: "Access declined",
    text: "Your access request wasn't approved. If this is a mistake, ask your editor or head.",
  },
  deactivated: {
    title: "No access",
    text: "Your access to the portal has ended. If this is a mistake, ask your editor or head.",
  },
} as const satisfies Record<
  InactiveMemberState,
  { title: string; text: string }
>
