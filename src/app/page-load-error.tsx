"use client"

import { Button } from "@/components/ui/button"

export type PageLoadErrorProps = {
  error: Error & { digest?: string }
  retry: () => void
}

/**
 * What a member or admin page shows when it throws: `(member)/error.tsx`
 * and `(admin)/error.tsx` render it inside their layout's shell, so the
 * header and navigation stay (EXPERIENCE.md's "Page failed to load";
 * first-draft copy). **Try again** calls Next's `retry()`, which requests
 * the page again.
 *
 * A server error's digest shows as "Error ID: <digest>", the id
 * `error_events` holds for it (OPERATIONS.md section 5); a client error has
 * none, so the line is left out. Nothing else on the error is shown, never
 * its message. It records nothing: `onRequestError` already recorded the
 * server error, and browser code never calls `recordErrorEvent`.
 *
 * A page's own not-found (Task detail's TaskNotFound) is rendered, not
 * thrown, so it never reaches here.
 */
export function PageLoadError({ error, retry }: PageLoadErrorProps) {
  return (
    <>
      <h1 className="font-heading text-heading text-navy">
        Couldn&apos;t load this page.
      </h1>
      <Button type="button" className="mt-4 min-h-11" onClick={() => retry()}>
        Try again
      </Button>
      {error.digest ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {`Error ID: ${error.digest}`}
        </p>
      ) : null}
    </>
  )
}
