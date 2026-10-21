import { createAdminClient } from "@/lib/supabase/admin"

// How long the database has to answer before the check fails.
const TIMEOUT_MS = 5000

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * Liveness probe for the uptime monitor: 200 `{status, timestamp}` once the
 * database answers `health_check()`, a `service_role`-only ping that reads
 * nothing; else 503 `{"status":"error"}` with no details, whether the
 * database answered with an error, answered something else, threw or took
 * more than 5 seconds.
 *
 * Read-only (AD-3), and it records nothing: its 503 is the signal, and the
 * database it would record into is the one that's down.
 */
export async function GET() {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, TIMEOUT_MS)
  })

  try {
    const healthy = await Promise.race([
      databaseAnswers(controller.signal),
      timedOut,
    ])
    if (!healthy) {
      return Response.json(
        { status: "error" },
        { status: 503, headers: NO_STORE }
      )
    }
    return Response.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: NO_STORE }
    )
  } finally {
    clearTimeout(timer)
  }
}

async function databaseAnswers(signal: AbortSignal): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .rpc("health_check")
      .abortSignal(signal)
    return error === null && data === true
  } catch {
    return false
  }
}
