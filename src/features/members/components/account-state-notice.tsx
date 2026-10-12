import { Button } from "@/components/ui/button"

import { ACCOUNT_STATE_COPY, type InactiveMemberState } from "../account-state"
import { signOutAction } from "../actions"

/**
 * What /login shows a signed-in member who isn't active (UX-DR52): the
 * state's title and text, and Sign out, which on Access declined is how they
 * try another account.
 */
export function AccountStateNotice({ state }: { state: InactiveMemberState }) {
  const copy = ACCOUNT_STATE_COPY[state]

  return (
    <>
      <h1 className="font-heading text-display text-navy">{copy.title}</h1>
      <p className="mt-2">{copy.text}</p>
      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline" className="min-h-11 text-base">
          Sign out
        </Button>
      </form>
    </>
  )
}
