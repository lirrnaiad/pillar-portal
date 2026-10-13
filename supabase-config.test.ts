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

// NEXT_PUBLIC_SITE_URL from .env.example, the local site.
function exampleSiteUrl(): string {
  const text = readFileSync(new URL("./.env.example", import.meta.url), "utf8")
  const match = /^NEXT_PUBLIC_SITE_URL=(.+)$/m.exec(text)
  if (!match) throw new Error(".env.example has no NEXT_PUBLIC_SITE_URL")
  return match[1].trim()
}

describe("supabase/config.toml auth settings", () => {
  const config = readConfig()

  it("allows sign-up, which a new member's first Google sign-in needs", () => {
    expect(config.get("auth.enable_signup")).toBe("true")
  })

  it("runs the before_user_created hook, which refuses every new user but a Google one", () => {
    expect(config.get("auth.hook.before_user_created.enabled")).toBe("true")
    expect(config.get("auth.hook.before_user_created.uri")).toBe(
      '"pg-functions://postgres/private/before_user_created"'
    )
  })

  it("enables Google with its client ID and secret from env substitution only", () => {
    expect(config.get("auth.external.google.enabled")).toBe("true")
    expect(config.get("auth.external.google.client_id")).toBe(
      '"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"'
    )
    expect(config.get("auth.external.google.secret")).toBe(
      '"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"'
    )
    expect(config.get("auth.external.google.skip_nonce_check")).toBe("false")
  })

  it("enables no other OAuth provider, and no phone or anonymous sign-in", () => {
    const enabledProviders = [...config.entries()]
      .filter(
        ([key, value]) =>
          /^(remotes\.[^.]+\.)?auth\.external\.[^.]+\.enabled$/.test(key) &&
          value === "true"
      )
      .map(([key]) => key)
    expect(enabledProviders).toEqual(["auth.external.google.enabled"])
    expect(config.get("auth.sms.enable_signup")).toBe("false")
    expect(config.get("auth.enable_anonymous_sign_ins")).toBe("false")
  })

  it("keeps the email provider on, which persona password sign-in needs", () => {
    // `[auth.email] enable_signup = false` turns off the whole email
    // provider, including signInWithPassword. The hook refuses email
    // sign-up instead.
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

  it("uses .env.example's NEXT_PUBLIC_SITE_URL and only its /auth/callback locally", () => {
    const site = exampleSiteUrl()
    expect(site).toBe("http://localhost:3000")
    expect(config.get("auth.site_url")).toBe(JSON.stringify(site))
    expect(config.get("auth.additional_redirect_urls")).toBe(
      JSON.stringify([`${site}/auth/callback`])
    )
  })

  it("requires passwords of 16+ characters, like PROTOTYPE_PERSONA_PASSWORD", () => {
    expect(config.get("auth.minimum_password_length")).toBe("16")
  })

  it("never times sessions out, so a link opened days later still opens signed in (NFR8)", () => {
    // No forced sign-out after a fixed time or after inactivity, locally or
    // on any remote: no `[auth.sessions]` (timebox, inactivity_timeout) or
    // `[remotes.<name>.auth.sessions]` values at all. Shared computers get
    // their own sessions in Epic 5.
    expect(
      [...config.keys()].filter((key) => key.includes("sessions."))
    ).toEqual([])
    // Each refresh hands out a new refresh token and retires the old one.
    expect(config.get("auth.enable_refresh_token_rotation")).toBe("true")
    // /login isn't proxied, so a refresh done while it renders can't save the
    // new cookies. Its redirect to a proxied path refreshes again with the
    // same refresh token, which Auth accepts only within this window (s).
    expect(config.get("auth.refresh_token_reuse_interval")).toBe("10")
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
