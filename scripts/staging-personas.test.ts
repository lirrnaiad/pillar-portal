import { chmodSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import { type Fixture, makeFixture, runScript } from "./test-fixture"

// Each case must refuse before any network or CLI call. The only `pnpm` on
// PATH is a fake that leaves a marker file, so a run that reached the CLI
// (which comes before any Auth call) would show up.
// It uses shell builtins only, since PATH holds nothing else.
const FAKE_PNPM = `#!/bin/sh
: > "\${0%/*}/../pnpm-was-called"
exit 1
`

const GOOD = {
  STAGING_SUPABASE_URL: "https://sxlgelitcaolpiijfwsq.supabase.co",
  STAGING_SUPABASE_SECRET_KEY: "sb_secret_fake-key-for-this-test-only",
  PROTOTYPE_PERSONA_PASSWORD: "a-generated-staging-password",
}

type EnvFile = Partial<Record<keyof typeof GOOD, string>>

let fixture: Fixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

function run({
  envFile = GOOD,
  envFileMode = 0o600,
  projectRef = "sxlgelitcaolpiijfwsq",
  env = {},
}: {
  envFile?: EnvFile
  envFileMode?: number
  projectRef?: string
  env?: Record<string, string>
} = {}) {
  fixture = makeFixture({
    ".env.staging.local": Object.entries(envFile)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
    "supabase/.temp/project-ref": `${projectRef}\n`,
    "bin/pnpm": FAKE_PNPM,
  })
  chmodSync(path.join(fixture.root, ".env.staging.local"), envFileMode)
  chmodSync(path.join(fixture.root, "bin/pnpm"), 0o755)

  const result = runScript("staging-personas.mjs", fixture.root, {
    env: { PATH: path.join(fixture.root, "bin"), ...env },
  })
  return {
    ...result,
    reachedCli: existsSync(path.join(fixture.root, "pnpm-was-called")),
  }
}

describe("staging-personas", () => {
  it.each(Object.keys(GOOD))(
    "refuses when %s is already set in the environment",
    (name) => {
      const result = run({ env: { [name]: "from-the-shell" } })

      expect(result.status).toBe(1)
      expect(result.output).toContain(
        `staging-personas: unset ${name} in this shell; the values come from .env.staging.local only.`
      )
      // Reaching this check means personas.ts loaded under plain Node.
      expect(result.output).not.toMatch(/ERR_|SyntaxError|TypeError/)
      expect(result.reachedCli).toBe(false)
    }
  )

  it("refuses a .env.staging.local others can read (0644)", () => {
    const result = run({ envFileMode: 0o644 })

    expect(result.status).toBe(1)
    expect(result.output).toContain("run `chmod 600 .env.staging.local` first.")
    expect(result.reachedCli).toBe(false)
  })

  it.each([
    "https://other.supabase.co",
    "http://sxlgelitcaolpiijfwsq.supabase.co",
    "https://sxlgelitcaolpiijfwsq.supabase.co.example.com",
    "not-a-url",
  ])("refuses the Supabase URL %s", (url) => {
    const result = run({ envFile: { ...GOOD, STAGING_SUPABASE_URL: url } })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "STAGING_SUPABASE_URL must be https://sxlgelitcaolpiijfwsq.supabase.co."
    )
    expect(result.reachedCli).toBe(false)
  })

  it.each([
    ["a publishable key", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"],
    [
      "a legacy JWT key",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x",
    ],
    ["nothing", ""],
  ])("refuses %s as the secret key", (_label, key) => {
    const result = run({
      envFile: { ...GOOD, STAGING_SUPABASE_SECRET_KEY: key },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "STAGING_SUPABASE_SECRET_KEY must be a secret key (sb_secret_...)."
    )
    expect(result.reachedCli).toBe(false)
  })

  it.each(["fifteen-chars!!", ""])(
    "refuses the password %j (under 16 characters)",
    (password) => {
      const result = run({
        envFile: { ...GOOD, PROTOTYPE_PERSONA_PASSWORD: password },
      })

      expect(result.status).toBe(1)
      expect(result.output).toContain(
        "PROTOTYPE_PERSONA_PASSWORD must be at least 16 characters."
      )
      expect(result.reachedCli).toBe(false)
    }
  )

  it("refuses the committed local persona password", () => {
    const example = parseEnv(
      readFileSync(new URL("../.env.example", import.meta.url), "utf8")
    )
    const result = run({
      envFile: {
        ...GOOD,
        PROTOTYPE_PERSONA_PASSWORD: example.PROTOTYPE_PERSONA_PASSWORD,
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "PROTOTYPE_PERSONA_PASSWORD must not be the committed local password"
    )
    expect(result.reachedCli).toBe(false)
  })

  it.each(["abcdefghijklmnopqrst", ""])(
    "refuses when the CLI is linked to %j instead of staging",
    (projectRef) => {
      const result = run({ projectRef })

      expect(result.status).toBe(1)
      expect(result.output).toContain(
        "the Supabase CLI must be linked to staging (sxlgelitcaolpiijfwsq)"
      )
      expect(result.reachedCli).toBe(false)
    }
  )

  it("never prints the secret key or the password", () => {
    const result = run({ projectRef: "abcdefghijklmnopqrst" })

    expect(result.status).toBe(1)
    expect(result.output).not.toContain(GOOD.STAGING_SUPABASE_SECRET_KEY)
    expect(result.output).not.toContain(GOOD.PROTOTYPE_PERSONA_PASSWORD)
  })

  it("passes the inputs checks and stops at the CLI when it can't run (control)", () => {
    // With every input valid, the next step is the CLI. The fake pnpm fails,
    // which shows the checks above are what stopped the other cases.
    const result = run()

    expect(result.reachedCli).toBe(true)
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "staging-personas: `supabase db query --linked` failed (exit 1)."
    )
    expect(result.output).not.toContain(GOOD.STAGING_SUPABASE_SECRET_KEY)
    expect(result.output).not.toContain(GOOD.PROTOTYPE_PERSONA_PASSWORD)
  })

  it("refuses clearly when pnpm can't be run at all", () => {
    const result = run({ env: { PATH: "/nonexistent" } })

    expect(result.status).toBe(1)
    expect(result.output).toMatch(
      /staging-personas: could not run `supabase db query --linked`: .*ENOENT/
    )
  })
})
