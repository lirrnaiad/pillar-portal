"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

import { signInWithGoogleAction } from "../actions"

/**
 * Sign in with Google (UX-DR52): one form posting to the Google action, with
 * `next` (already checked by `safeReturnPath`; the action and the callback
 * check it again) in a hidden field. It works before hydration too: the
 * action's redirect is then a 303 the browser follows.
 */
export function GoogleSignIn({ next }: { next: string }) {
  return (
    <form action={signInWithGoogleAction}>
      <input type="hidden" name="next" value={next} />
      <GoogleButton />
    </form>
  )
}

// While the action runs (and the browser leaves for Google), the button stays
// focusable but `aria-disabled`, and a second press is ignored.
function GoogleButton() {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant="outline"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault()
      }}
      className="min-h-11 w-full gap-3 border-card-edge bg-card text-base shadow-card aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      {/* A fixed 18px brand mark from /public; next/image adds nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/google-g.svg" alt="" width={18} height={18} />
      Sign in with Google
    </Button>
  )
}
