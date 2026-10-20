// The members slice's public surface (AD-2): code outside the slice imports
// from here only.
export { ACCOUNT_STATE_COPY, memberStateOf } from "./account-state"
export type { InactiveMemberState, MemberState } from "./account-state"
export {
  approveMemberAction,
  declineMemberAction,
  signInAsPersonaAction,
  signInWithGoogleAction,
  signOutAction,
} from "./actions"
export type { MemberCommandState, PersonaSignInState } from "./actions"
export { AccountStateNotice } from "./components/account-state-notice"
export { GoogleSignIn } from "./components/google-sign-in"
export { InAppBrowserNotice } from "./components/in-app-browser-notice"
export { MemberApprovals } from "./components/member-approvals"
export { MemberApprovalsSkeleton } from "./components/member-approvals-skeleton"
export { MemberMenu } from "./components/member-menu"
export type { MemberMenuExtraLink } from "./components/member-menu"
export { PersonaSignIn } from "./components/persona-sign-in"
export { MEMBER_ERROR_COPY, memberErrorMessage } from "./errors"
export type { MemberErrorCode } from "./errors"
export { homeScopeOf, WRITERS_DESK_ID } from "./home-scope"
export type { HomeScope, HomeScopePosition } from "./home-scope"
export { detectInAppBrowser } from "./in-app-browser"
export type { InAppBrowser } from "./in-app-browser"
export { initialsOf } from "./initials"
export { PERSONAS } from "./personas"
export type { PersonaKey } from "./personas"
export { PRODUCTION_ROLE_LABELS } from "./production-roles"
export type { ProductionRole } from "./production-roles"
export {
  countPendingApprovalsForViewer,
  getCurrentMember,
  getMemberApprovals,
  getMyHomeScope,
  requireActiveMember,
} from "./queries"
export type {
  ActiveMember,
  CurrentMember,
  MemberApprovalsData,
  MemberRole,
  PendingMember,
  RosterMember,
} from "./queries"
export { LOGIN_ERROR_SIGN_IN, loginPath, safeReturnPath } from "./return-path"
export {
  memberApproveSchema,
  memberDeclineSchema,
  personaSignInSchema,
} from "./schemas"
export type { MemberApproveInput, MemberDeclineInput } from "./schemas"
