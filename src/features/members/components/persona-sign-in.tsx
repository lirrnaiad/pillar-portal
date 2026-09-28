"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"

import { signInAsPersonaAction } from "../actions"
import { memberErrorMessage } from "../errors"
import { PERSONA_KEYS, PERSONAS } from "../personas"

/**
 * One button per prototype persona, all in one form: the pressed button's
 * `persona` value is what the action receives. Errors are announced in a
 * polite live region that is always in the DOM, so screen readers hear the
 * change. The message is cleared while an attempt is pending, so a second
 * identical failure re-enters the region and is announced again.
 */
export function PersonaSignIn() {
  const [state, formAction, pending] = useActionState(
    signInAsPersonaAction,
    null
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {PERSONA_KEYS.map((key) => (
        <Button
          key={key}
          type="submit"
          name="persona"
          value={key}
          disabled={pending}
          className="min-h-11 w-full text-base"
        >
          {PERSONAS[key].label}
        </Button>
      ))}
      <p
        aria-live="polite"
        className="min-h-5 text-sm text-status-attention-text"
      >
        {state && !pending ? memberErrorMessage(state.code) : null}
      </p>
    </form>
  )
}
