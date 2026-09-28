// The only module besides env.client.ts that reads `process.env` (AD-6).
// Server-only values live here; importing this file from client code fails
// the build. `scripts/check-bundle-secrets.mjs` imports it directly under
// Node and reads `serverEnvSchema.shape`, so keep the schema a plain
// z.object and keep imports to packages only (no `@/`, no relative imports).
import "server-only"
import { z } from "zod"

// Prototype personas (AD-7) may be on only against the local Supabase stack
// or the staging project, never production. A Vercel deploy can't tell
// staging from production by VERCEL_ENV (staging is a production deploy of
// its own project), so the rule follows the Supabase project instead.
const STAGING_SUPABASE_ORIGIN = "https://sxlgelitcaolpiijfwsq.supabase.co"
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"])
const PERSONA_PASSWORD_MIN_LENGTH = 16

// An empty value (`NAME=` in an env file) counts as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional())

// Each key added here needs a canary value in CI so `pnpm check:bundle` can
// prove it never reaches the browser.
export const serverEnvSchema = z.object({
  // "true" turns on persona sign-in on /login. Unset means off.
  PROTOTYPE_PERSONAS: optional(
    z.enum(["true", "false"], { error: 'must be "true" or "false"' })
  ),
  // The shared password of the persona auth users. Locally it is the value
  // supabase/seed.sql sets; staging's comes from scripts/staging-personas.mjs.
  PROTOTYPE_PERSONA_PASSWORD: optional(
    z.string().min(PERSONA_PASSWORD_MIN_LENGTH, {
      error: `must be at least ${PERSONA_PASSWORD_MIN_LENGTH} characters`,
    })
  ),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

function isPersonaProject(supabaseUrl: string | undefined) {
  if (supabaseUrl === undefined || !URL.canParse(supabaseUrl)) return false
  const url = new URL(supabaseUrl)
  return (
    url.origin === STAGING_SUPABASE_ORIGIN ||
    (LOCAL_HOSTNAMES.has(url.hostname) &&
      (url.protocol === "http:" || url.protocol === "https:"))
  )
}

const parsed = serverEnvSchema.safeParse(process.env)

const problems = parsed.success
  ? []
  : parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
    )

// Checks across variables. NEXT_PUBLIC_SUPABASE_URL is read here but stays out
// of the schema: it belongs in the browser bundle, so check:bundle must not
// scan for it.
if (parsed.success && parsed.data.PROTOTYPE_PERSONAS === "true") {
  if (!isPersonaProject(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    problems.push(
      `  - PROTOTYPE_PERSONAS: must not be "true" unless NEXT_PUBLIC_SUPABASE_URL is the local stack (localhost or 127.0.0.1) or the staging project (${STAGING_SUPABASE_ORIGIN})`
    )
  }
  if (parsed.data.PROTOTYPE_PERSONA_PASSWORD === undefined) {
    problems.push(
      "  - PROTOTYPE_PERSONA_PASSWORD: required when PROTOTYPE_PERSONAS is true"
    )
  }
}

if (!parsed.success || problems.length > 0) {
  throw new Error(
    `Invalid server environment variables:\n${problems.join("\n")}`
  )
}

export const serverEnv: ServerEnv = parsed.data

/** Persona sign-in is on (AD-7). Boot has already refused it off-project. */
export const personasEnabled = serverEnv.PROTOTYPE_PERSONAS === "true"
