// The only module besides env.server.ts that reads `process.env` (AD-6).
// Safe for the browser: it holds NEXT_PUBLIC_* values only, each read by its
// literal name so Next can inline it at build time. `next.config.ts` imports
// this module, so a bad value stops `next build`, `next dev` and `next start`.
// Keep imports to packages only: next.config.ts loads this file directly.
import { z } from "zod"

const MISSING = "missing (see .env.example)"

// Zod 4's bare z.url() accepts `localhost:3000` and `javascript:` URLs.
const httpUrl = () =>
  z.url({
    protocol: /^https?$/,
    error: (issue) =>
      issue.input === undefined || issue.input === ""
        ? MISSING
        : "must be an http:// or https:// URL",
  })

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"])

// The Supabase API as a bare origin, such as https://<ref>.supabase.co. The
// clients and the CSP build on it, so a path, query, fragment or credentials
// are always a mistake, and plain http is allowed only for the local stack.
const supabaseUrl = () =>
  httpUrl().superRefine((value, ctx) => {
    // httpUrl() has already reported a value that isn't an http(s) URL.
    if (!URL.canParse(value)) return
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message, input: value })

    if (url.protocol === "http:" && !LOCAL_HOSTNAMES.has(url.hostname)) {
      problem(
        "must be an https:// URL (http:// is allowed only for localhost and 127.0.0.1)"
      )
    }
    if (url.username !== "" || url.password !== "") {
      problem("must not contain a username or password")
    }
    if (url.pathname !== "/") {
      problem(
        "must be the bare origin with no path (such as https://<ref>.supabase.co)"
      )
    }
    // `href` keeps a bare `?` or `#`, which `search` and `hash` report as "".
    if (url.href.includes("?")) problem("must not contain a query string")
    if (url.href.includes("#")) problem("must not contain a #fragment")
  })

// The browser gets the publishable key only. A secret key (`sb_secret_`) or a
// legacy JWT key (`eyJ...`) here would ship in the client bundle.
const publishableKey = () =>
  z
    .string({ error: MISSING })
    .min(1, { error: MISSING, abort: true })
    .regex(/^sb_publishable_\S+$/, {
      error: "must be a Supabase publishable key (sb_publishable_...)",
    })

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: httpUrl(),
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey(),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})

if (!parsed.success) {
  const problems = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
  )
  throw new Error(
    `Invalid client environment variables:\n${problems.join("\n")}`
  )
}

export const clientEnv: ClientEnv = parsed.data
