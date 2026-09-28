import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

// The Auth settings in supabase/config.toml are code (AD-7): `supabase start`
// applies them locally and `supabase config push` applies them to staging.
// This reads the few that must not drift, without a TOML parser: each
// `key = value` line is filed under the most recent `[section]` header.
function readConfig(): Map<string, string> {
  const text = readFileSync(
    new URL("./supabase/config.toml", import.meta.url),
    "utf8"
  )
  const values = new Map<string, string>()
  let section = ""
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const entry = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line)
    if (entry) values.set(`${section}.${entry[1]}`, entry[2].trim())
  }
  return values
}

describe("supabase/config.toml auth settings", () => {
  const config = readConfig()

  it("refuses self sign-up, so every account is a persona or a seeded member", () => {
    expect(config.get("auth.enable_signup")).toBe("false")
  })

  it("keeps the email provider on, which persona password sign-in needs", () => {
    // `[auth.email] enable_signup = false` turns off the whole email
    // provider, including signInWithPassword.
    expect(config.get("auth.email.enable_signup")).toBe("true")
  })

  it("points the staging remote at the staging project and site", () => {
    expect(config.get("remotes.staging.project_id")).toBe(
      '"sxlgelitcaolpiijfwsq"'
    )
    expect(config.get("remotes.staging.auth.site_url")).toBe(
      '"https://pillar-portal-staging.vercel.app"'
    )
  })

  it("allows only the staging site's /auth/callback as a staging redirect", () => {
    expect(config.get("remotes.staging.auth.additional_redirect_urls")).toBe(
      '["https://pillar-portal-staging.vercel.app/auth/callback"]'
    )
  })

  it("uses http://localhost:3000 and its /auth/callback locally", () => {
    expect(config.get("auth.site_url")).toBe('"http://localhost:3000"')
    expect(config.get("auth.additional_redirect_urls")).toBe(
      '["http://localhost:3000/auth/callback"]'
    )
  })

  it("requires passwords of 16+ characters, like PROTOTYPE_PERSONA_PASSWORD", () => {
    expect(config.get("auth.minimum_password_length")).toBe("16")
  })

  it("gives the shared server IP room for a demo audience's persona sign-ins", () => {
    // Every persona sign-in comes from the app server, so all visitors share
    // one per-IP budget.
    expect(config.get("auth.rate_limit.sign_in_sign_ups")).toBe("300")
  })
})

// `supabase config push` sends every declared value, so these stay equal to
// what the hosted staging project already has; a push then changes only the
// Auth and API settings above.
describe("supabase/config.toml values kept equal to hosted staging", () => {
  const config = readConfig()

  it.each([
    ["db.pooler.default_pool_size", "15"],
    ["db.pooler.max_client_conn", "200"],
    ["auth.email.enable_confirmations", "true"],
    ["auth.email.max_frequency", '"1m"'],
    ["auth.email.otp_length", "8"],
    ["auth.mfa.totp.enroll_enabled", "true"],
    ["auth.mfa.totp.verify_enabled", "true"],
  ])("%s = %s", (key, value) => {
    expect(config.get(key)).toBe(value)
  })
})
