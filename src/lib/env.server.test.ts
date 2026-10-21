import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321"
const STAGING_SUPABASE_URL = "https://sxlgelitcaolpiijfwsq.supabase.co"
const PASSWORD = "a-persona-password-for-tests"
// The shape of a secret key, built at runtime so no key-shaped literal sits
// in the source (GitHub's push protection blocks Supabase secrets).
const SECRET_KEY = "sb_secret_" + "a-key-for-these-tests-only"

type Env = {
  PROTOTYPE_PERSONAS?: string
  PROTOTYPE_PERSONA_PASSWORD?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SECRET_KEY?: string
  VERCEL_ENV?: string
}

// Stubs every variable the module reads (unset unless given, but for a valid
// secret key and the local Supabase URL), so nothing ambient, such as CI's
// job env, can change the result.
async function loadServerEnv(env: Env = {}) {
  vi.stubEnv(
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SECRET_KEY" in env ? env.SUPABASE_SECRET_KEY : SECRET_KEY
  )
  vi.stubEnv("PROTOTYPE_PERSONAS", env.PROTOTYPE_PERSONAS)
  vi.stubEnv("PROTOTYPE_PERSONA_PASSWORD", env.PROTOTYPE_PERSONA_PASSWORD)
  vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV)
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL" in env
      ? env.NEXT_PUBLIC_SUPABASE_URL
      : LOCAL_SUPABASE_URL
  )
  vi.resetModules()
  return import("./env.server")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("serverEnv", () => {
  it("lists exactly the server-only variables in its schema", async () => {
    const { serverEnvSchema } = await loadServerEnv()
    expect(Object.keys(serverEnvSchema.shape).sort()).toEqual([
      "PROTOTYPE_PERSONAS",
      "PROTOTYPE_PERSONA_PASSWORD",
      "SUPABASE_SECRET_KEY",
    ])
  })

  it("keeps VERCEL_ENV out of the schema, so check:bundle never scans for it", async () => {
    const { serverEnvSchema, serverEnv } = await loadServerEnv({
      VERCEL_ENV: "production",
    })
    expect(serverEnvSchema.shape).not.toHaveProperty("VERCEL_ENV")
    expect(serverEnv).not.toHaveProperty("VERCEL_ENV")
  })

  it("defaults to personas off and exposes no ambient variables", async () => {
    vi.stubEnv("SOME_UNRELATED_SECRET", "canary-value-1234")
    const { serverEnv, personasEnabled } = await loadServerEnv()

    expect(serverEnv).toEqual({ SUPABASE_SECRET_KEY: SECRET_KEY })
    expect(personasEnabled).toBe(false)
  })

  it("accepts a secret key", async () => {
    const { serverEnv } = await loadServerEnv()
    expect(serverEnv.SUPABASE_SECRET_KEY).toBe(SECRET_KEY)
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a publishable key", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"],
    [
      "a legacy JWT key",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl",
    ],
    ["the bare prefix", "sb_secret_"],
    ["a key one character short", "sb_secret_" + "a".repeat(15)],
    ["a key with a space", "sb_secret_" + "a".repeat(16) + " "],
  ])(
    "refuses to boot when SUPABASE_SECRET_KEY is %s, naming it",
    async (_label, value) => {
      await expect(
        loadServerEnv({ SUPABASE_SECRET_KEY: value })
      ).rejects.toThrow(
        /SUPABASE_SECRET_KEY: must be a secret key \(sb_secret_…\)/
      )
    }
  )

  it("never repeats a refused key's value in the error", async () => {
    const value = "sb_secret_" + "not valid!".repeat(3)
    const error = await loadServerEnv({ SUPABASE_SECRET_KEY: value }).catch(
      (thrown: unknown) => thrown
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(value)
  })

  it.each([undefined, "", "false"])(
    "leaves personas off when PROTOTYPE_PERSONAS is %j",
    async (value) => {
      const { personasEnabled } = await loadServerEnv({
        PROTOTYPE_PERSONAS: value,
        // Any project is fine while personas are off.
        NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      })
      expect(personasEnabled).toBe(false)
    }
  )

  it.each([
    ["the local stack at 127.0.0.1", LOCAL_SUPABASE_URL],
    ["the local stack at localhost", "http://localhost:54321"],
    ["the staging project", STAGING_SUPABASE_URL],
    ["the staging project with a trailing slash", `${STAGING_SUPABASE_URL}/`],
  ])("turns personas on against %s", async (_label, supabaseUrl) => {
    const { serverEnv, personasEnabled } = await loadServerEnv({
      PROTOTYPE_PERSONAS: "true",
      PROTOTYPE_PERSONA_PASSWORD: PASSWORD,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    })
    expect(personasEnabled).toBe(true)
    expect(serverEnv.PROTOTYPE_PERSONA_PASSWORD).toBe(PASSWORD)
  })

  it.each([
    "https://other.supabase.co",
    "http://sxlgelitcaolpiijfwsq.supabase.co",
    "https://sxlgelitcaolpiijfwsq.supabase.co.example.com",
    undefined,
    "not-a-url",
  ])(
    "refuses to boot with personas on against %j, naming PROTOTYPE_PERSONAS",
    async (supabaseUrl) => {
      await expect(
        loadServerEnv({
          PROTOTYPE_PERSONAS: "true",
          PROTOTYPE_PERSONA_PASSWORD: PASSWORD,
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        })
      ).rejects.toThrow(/PROTOTYPE_PERSONAS: must not be "true" unless/)
    }
  )

  it.each([undefined, ""])(
    "refuses to boot with personas on and the password %j, naming it",
    async (password) => {
      await expect(
        loadServerEnv({
          PROTOTYPE_PERSONAS: "true",
          PROTOTYPE_PERSONA_PASSWORD: password,
        })
      ).rejects.toThrow(
        /PROTOTYPE_PERSONA_PASSWORD: required when PROTOTYPE_PERSONAS is true/
      )
    }
  )

  it.each(["true", "false"])(
    "refuses a password under 16 characters (personas %s), naming it",
    async (personas) => {
      await expect(
        loadServerEnv({
          PROTOTYPE_PERSONAS: personas,
          PROTOTYPE_PERSONA_PASSWORD: "fifteen-chars!!",
        })
      ).rejects.toThrow(
        /PROTOTYPE_PERSONA_PASSWORD: must be at least 16 characters/
      )
    }
  )

  it.each(["yes", "TRUE", "1"])(
    "refuses PROTOTYPE_PERSONAS=%s, naming it",
    async (value) => {
      await expect(
        loadServerEnv({ PROTOTYPE_PERSONAS: value })
      ).rejects.toThrow(/PROTOTYPE_PERSONAS: must be "true" or "false"/)
    }
  )
})

describe("isProduction", () => {
  const PRODUCTION_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co"

  it("is true for a Vercel production deploy on a project other than local or staging", async () => {
    const { isProduction } = await loadServerEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
    })
    expect(isProduction).toBe(true)
  })

  it.each([
    ["the staging project", STAGING_SUPABASE_URL],
    ["the staging project with a trailing slash", `${STAGING_SUPABASE_URL}/`],
    ["the local stack at 127.0.0.1", LOCAL_SUPABASE_URL],
    ["the local stack at localhost", "http://localhost:54321"],
    ["no Supabase URL", undefined],
    ["a Supabase URL that doesn't parse", "not-a-url"],
  ])(
    "is false for a Vercel production deploy on %s",
    async (_label, supabaseUrl) => {
      const { isProduction } = await loadServerEnv({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      })
      expect(isProduction).toBe(false)
    }
  )

  it.each([
    ["preview", "preview"],
    ["development", "development"],
    ["empty", ""],
    ["unset", undefined],
    ["Production, in another case", "Production"],
  ])(
    "is false on another project when VERCEL_ENV is %s",
    async (_label, vercelEnv) => {
      const { isProduction } = await loadServerEnv({
        VERCEL_ENV: vercelEnv,
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
      })
      expect(isProduction).toBe(false)
    }
  )
})

describe(".env.example", () => {
  it("holds persona values the schema accepts against the local stack", async () => {
    const example = parseEnv(
      readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
    )
    const { personasEnabled, serverEnv } = await loadServerEnv({
      PROTOTYPE_PERSONAS: example.PROTOTYPE_PERSONAS,
      PROTOTYPE_PERSONA_PASSWORD: example.PROTOTYPE_PERSONA_PASSWORD,
      NEXT_PUBLIC_SUPABASE_URL: example.NEXT_PUBLIC_SUPABASE_URL,
    })
    expect(personasEnabled).toBe(true)
    expect(serverEnv.PROTOTYPE_PERSONA_PASSWORD).toBe(
      example.PROTOTYPE_PERSONA_PASSWORD
    )
  })

  it("names SUPABASE_SECRET_KEY but leaves it empty: each machine copies its own", () => {
    const example = parseEnv(
      readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
    )
    expect(example).toHaveProperty("SUPABASE_SECRET_KEY", "")
  })
})
