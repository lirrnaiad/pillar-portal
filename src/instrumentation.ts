import type { Instrumentation } from "next"

// Runs once when a Next.js server instance starts, before it serves requests.
//
// - env.server: this is where server-only variables are checked at start.
//   `next build` never calls register(), but it still evaluates env.server
//   while collecting page data, since route modules reach it through the
//   `members` barrel; so a missing or malformed value fails a Vercel build
//   too, and the live deployment stays as it was.
// - env.client: NEXT_PUBLIC_* values are inlined at build time, so this only
//   re-checks the value the build baked in. The start-time refusal of a
//   missing or malformed NEXT_PUBLIC_SITE_URL comes from next.config.ts,
//   which imports env.client when `next dev`, `next build` or `next start`
//   loads the config.
export async function register() {
  await import("@/lib/env.server")
  await import("@/lib/env.client")
}

/**
 * Records every error Next.js captures on the server (a thrown render, Route
 * Handler, Server Action or proxy) in `error_events`, as
 * `<routeType> <routePath>` (the route's file pattern, never its real path)
 * with the error's code and digest. `redirect()` and `notFound()` never get
 * here.
 *
 * It never reads `request`: its path, query and headers can hold personal
 * data. The recorder never rejects; the dynamic import is guarded too, so a
 * failure here never reaches the request. It is awaited, as Next asks.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context
) => {
  try {
    const { recordErrorEvent } = await import("@/lib/record-error-event")
    await recordErrorEvent(error, {
      route: `${context.routeType} ${context.routePath}`,
    })
  } catch {
    console.error("onRequestError: couldn't load the error recorder")
  }
}
