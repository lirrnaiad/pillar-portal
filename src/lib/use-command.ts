import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { refreshAfterFailure } from "./refresh-after-failure"

/**
 * The part of AD-3's action result the hook reads: `ok`, and on a refusal its
 * `code`. A success reaches `onSuccess` whole, `data` included; a refusal's
 * `params` aren't read, so copy that needs them can't come from this hook.
 */
export type CommandResult<TCode extends string> =
  { ok: true } | { ok: false; code: TCode }

export type CommandCallbacks<TResult, TCode extends string> = {
  /**
   * Runs before the transition ends, so `isPending` is still true: it suits
   * moving focus and showing a toast. It runs after an `await`, so a state
   * update made in it isn't a transition update unless the caller wraps it in
   * `startTransition`.
   */
  onSuccess?: (result: Extract<TResult, { ok: true }>) => void
  /** Runs after the error toast and the re-read. */
  onFailure?: (code: TCode) => void
}

/**
 * Runs a command control's Server Action, one at a time: in a transition,
 * and on a refused result or a rejected call, a toast with the code's copy
 * (`thrownCode`'s when the call's promise rejects) and a re-read of the page
 * (`refreshAfterFailure`), so an optimistic change rolls back to what the
 * database holds. The caller's callbacks decide where focus goes.
 *
 * `run` takes a thunk rather than a promise: it runs at the start of the
 * transition, so an optimistic setter called in it (React warns about one
 * outside a transition or action) shows before the action's promise is
 * awaited. Only the promise it returns counts as the call: a throw from the
 * thunk's synchronous part (the optimistic setter) is a programming error,
 * not a failed save, so it is never turned into the `thrownCode` toast. A
 * `run` while one is still pending is ignored and its thunk never runs.
 */
export function useCommand<TCode extends string>({
  errorMessage,
  thrownCode,
}: {
  errorMessage: (code: TCode) => string
  thrownCode: NoInfer<TCode>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function run<TResult extends CommandResult<TCode>>(
    call: () => Promise<TResult>,
    { onSuccess, onFailure }: CommandCallbacks<TResult, TCode> = {}
  ) {
    if (isPending) return

    function fail(code: TCode) {
      toast.error(errorMessage(code))
      refreshAfterFailure(router)
      onFailure?.(code)
    }

    startTransition(async () => {
      const promise = call()
      let result: TResult
      try {
        result = await promise
      } catch {
        fail(thrownCode)
        return
      }
      const outcome: CommandResult<TCode> = result
      if (!outcome.ok) {
        fail(outcome.code)
        return
      }
      onSuccess?.(result as Extract<TResult, { ok: true }>)
    })
  }

  return { isPending, run }
}
