// The only module besides env.server.ts that reads `process.env` (AD-6).
// Safe for the browser: it holds NEXT_PUBLIC_* values only, each read by its
// literal name so Next can inline it at build time. `next.config.ts` imports
// this module, so a bad value stops `next build`, `next dev` and `next start`.
// Keep imports to packages only: next.config.ts loads this file directly.
import { z } from "zod"

// Zod 4's bare z.url() accepts `localhost:3000` and `javascript:` URLs.
const httpUrl = () =>
  z.url({
    protocol: /^https?$/,
    error: (issue) =>
      issue.input === undefined || issue.input === ""
        ? "missing (see .env.example)"
        : "must be an http:// or https:// URL",
  })

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: httpUrl(),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
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
