import { Button } from "@/components/ui/button"

import { ACCOUNT_STATE_COPY, type InactiveMemberState } from "../account-state"
import { signOutAction } from "../actions"

/**
 * What /login shows a signed-in member who isn't active (UX-DR52): the
 * state's title and text, and Sign out, which on Access declined is how they
 * try another account. `next` (already checked by `safeReturnPath`) rides
 * along, so signing out comes back to /login with it, and the other account
 * still lands on the link they opened.
 */
export function AccountStateNotice({
  state,
  next,
}: {
  state: InactiveMemberState
  next: string
}) {
  const copy = ACCOUNT_STATE_COPY[state]

  return (
    <>
      <h1 className="font-heading text-display text-navy">{copy.title}</h1>
      <p className="mt-2">{copy.text}</p>
      <form action={signOutAction} className="mt-6">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" className="min-h-11 text-base">
          Sign out
        </Button>
      </form>
    </>
  )
}
