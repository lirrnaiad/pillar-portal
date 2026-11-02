import { STALE_COPY } from "@/lib/command-copy"

// Error codes the members slice's actions return, and the copy each one shows
// (EXPERIENCE.md). Raw auth or database errors never reach the UI.
//
// approve_member and decline_member raise `members.stale` when the member is
// no longer pending (another admin acted first) and `members.not_found` when
// the row is gone; on /admin/members both mean the row changed under the
// admin, so both get EXPERIENCE.md's stale line and the list re-reads. Any
// other code (members.not_admin, and the position backstops the picker never
// reaches), a parse failure or a thrown call is `members.save_failed`.
export const MEMBER_ERROR_COPY = {
  "auth.personas_off": "Persona sign-in is off.",
  "auth.sign_in_failed": "Sign-in didn't finish. Try again.",
  "auth.not_active": "Sign in to do that.",
  "members.stale": STALE_COPY,
  "members.not_found": STALE_COPY,
  "members.save_failed": "Couldn't save — try again.",
} as const

export type MemberErrorCode = keyof typeof MEMBER_ERROR_COPY

export function memberErrorMessage(code: MemberErrorCode): string {
  return MEMBER_ERROR_COPY[code]
}
