import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Where an error happened, as the recording site names it.
 *
 * - `route`: `action <name>`, `render <route file pattern>`,
 *   `route <path pattern>`, never a real path or a query string.
 * - `entityType`/`entityId`: the row an action was about (`task` and its id),
 *   when there is one.
 */
export type ErrorEventWhere = {
  route: string
  entityType?: string
  entityId?: string
}

export type ErrorEventArgs =
  Database["public"]["Functions"]["record_error_event"]["Args"]

// The allowlist. `public.error_events`' CHECKs mirror each pattern. Their
// charsets have no room for a sentence or a body, and an email needs both
// `@` and `.`, which neither the code nor the digest allows together. The
// digest allows `@` because Next stamps its own errors `<hash>@E<n>`.
const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
const DIGEST_PATTERN = /^[A-Za-z0-9_@-]{1,64}$/
const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROUTE_MAX = 200
const UNKNOWN = "unknown"
const RECORD_TIMEOUT_MS = 3000

// A property of a thrown value, or undefined. A getter that throws counts as
// missing.
function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function stringProperty(value: unknown, key: string): string | undefined {
  const found = property(value, key)
  return typeof found === "string" ? found : undefined
}

// A string property that fits the code allowlist, or undefined.
function fittingCode(value: unknown, key: string): string | undefined {
  const candidate = stringProperty(value, key)
  return candidate !== undefined && CODE_PATTERN.test(candidate)
    ? candidate
    : undefined
}

/**
 * An error's code, the first that fits the allowlist of:
 *
 * 1. its own string `code` (a SQLSTATE, a `PGRST...` code, an Auth code);
 * 2. its `cause`'s `code`, one level only: the slice queries throw
 *    `new Error("...", { cause: postgrestError })`, whose own code is
 *    missing;
 * 3. its `name`;
 *
 * else `unknown`. Never a message, and nothing else of the `cause`.
 */
export function errorCodeOf(error: unknown): string {
  return (
    fittingCode(error, "code") ??
    fittingCode(property(error, "cause"), "code") ??
    fittingCode(error, "name") ??
    UNKNOWN
  )
}

function routeOf(route: unknown): string {
  if (typeof route !== "string") return UNKNOWN
  const [path] = route.split("?", 1)
  // By code point, as Postgres counts characters.
  const capped = Array.from(path).slice(0, ROUTE_MAX).join("")
  return capped === "" ? UNKNOWN : capped
}

/**
 * The `error_events` row for an error, built from the allowlist only: the
 * code (`errorCodeOf`), the route (cut at any `?` and capped at 200
 * characters), the entity type and uuid when both fit, and Next.js's digest
 * when it fits. Nothing else on the error (message, details, hint, stack,
 * and of its `cause` only the code) and nothing from the request is ever
 * read.
 */
export function errorEventOf(
  error: unknown,
  where: ErrorEventWhere
): ErrorEventArgs {
  const event: ErrorEventArgs = {
    code: errorCodeOf(error),
    route: routeOf(where.route),
  }

  const { entityType, entityId } = where
  if (typeof entityType === "string" && ENTITY_TYPE_PATTERN.test(entityType)) {
    event.entity_type = entityType
    if (typeof entityId === "string" && UUID_PATTERN.test(entityId)) {
      event.entity_id = entityId
    }
  }

  const digest = stringProperty(error, "digest")
  if (digest !== undefined && DIGEST_PATTERN.test(digest)) {
    event.digest = digest
  }

  return event
}

/**
 * Records an unexpected server error in `error_events` (Vercel Hobby keeps
 * logs for one hour) through the secret-key client's `record_error_event`.
 *
 * It never rejects and never throws: a failed or slow write (3 seconds at
 * most) is logged with its code only and dropped, so recording never
 * changes what the user sees. Server code only; a request records through
 * `after()` (src/instrumentation.ts awaits it instead, as Next asks).
 */
export async function recordErrorEvent(
  error: unknown,
  where: ErrorEventWhere
): Promise<void> {
  try {
    const { error: rpcError } = await createAdminClient()
      .rpc("record_error_event", errorEventOf(error, where))
      .abortSignal(AbortSignal.timeout(RECORD_TIMEOUT_MS))
    if (rpcError) {
      console.error(
        "recordErrorEvent: record_error_event failed",
        errorCodeOf(rpcError)
      )
    }
  } catch (thrown) {
    console.error(
      "recordErrorEvent: record_error_event threw",
      errorCodeOf(thrown)
    )
  }
}
