// The only module besides env.client.ts that reads `process.env` (AD-6).
// Server-only values live here; importing this file from client code fails
// the build. `scripts/check-bundle-secrets.mjs` imports it directly under
// Node, so keep imports to packages only (no `@/`, no relative imports).
import "server-only"
import { z } from "zod"

// Empty until Story 1.2. Each key added here needs a canary value in CI so
// `pnpm check:bundle` can prove it never reaches the browser.
export const serverEnvSchema = z.object({})

export type ServerEnv = z.infer<typeof serverEnvSchema>

const parsed = serverEnvSchema.safeParse(process.env)

if (!parsed.success) {
  const problems = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
  )
  throw new Error(
    `Invalid server environment variables:\n${problems.join("\n")}`
  )
}

export const serverEnv: ServerEnv = parsed.data
