// Error codes the members slice's actions return, and the copy each one shows
// (EXPERIENCE.md). Raw auth or database errors never reach the UI.
export const MEMBER_ERROR_COPY = {
  "auth.personas_off": "Persona sign-in is off.",
  "auth.sign_in_failed": "Sign-in didn't finish. Try again.",
} as const

export type MemberErrorCode = keyof typeof MEMBER_ERROR_COPY

export function memberErrorMessage(code: MemberErrorCode): string {
  return MEMBER_ERROR_COPY[code]
}
