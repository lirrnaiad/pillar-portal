import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

const VALID = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
}

type Name = keyof typeof VALID

// Stubs every client variable (valid unless overridden), so nothing ambient,
// such as CI's job env, can change the result.
async function loadClientEnv(overrides: Partial<Record<Name, string>> = {}) {
  for (const name of Object.keys(VALID) as Name[]) {
    vi.stubEnv(name, name in overrides ? overrides[name] : VALID[name])
  }
  vi.resetModules()
  return import("./env.client")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("clientEnv", () => {
  it("holds all three variables when they are valid", async () => {
    const { clientEnv } = await loadClientEnv()
    expect(clientEnv).toEqual(VALID)
  })

  describe("NEXT_PUBLIC_SITE_URL", () => {
    it.each([
      "https://pillar-portal-staging.vercel.app",
      "http://localhost:3000",
    ])("accepts %s", async (siteUrl) => {
      const { clientEnv } = await loadClientEnv({
        NEXT_PUBLIC_SITE_URL: siteUrl,
      })
      expect(clientEnv.NEXT_PUBLIC_SITE_URL).toBe(siteUrl)
    })

    it.each([undefined, ""])(
      "throws naming the variable when it is missing (%j)",
      async (siteUrl) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SITE_URL: siteUrl })
        ).rejects.toThrow(/NEXT_PUBLIC_SITE_URL: missing/)
      }
    )

    it.each([
      "not-a-url",
      "localhost:3000",
      "javascript:alert(1)",
      "ftp://x.y",
    ])(
      "throws naming the variable when it is malformed (%s)",
      async (siteUrl) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SITE_URL: siteUrl })
        ).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/)
      }
    )
  })

  describe("NEXT_PUBLIC_SUPABASE_URL", () => {
    it.each([
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "https://abcdefghijklmnop.supabase.co",
      "https://abcdefghijklmnop.supabase.co/",
    ])("accepts %s", async (supabaseUrl) => {
      const { clientEnv } = await loadClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      })
      expect(clientEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(supabaseUrl)
    })

    it.each([undefined, ""])(
      "throws naming the variable when it is missing (%j)",
      async (supabaseUrl) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl })
        ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL: missing/)
      }
    )

    it.each(["not-a-url", "127.0.0.1:54321", "ws://127.0.0.1:54321"])(
      "throws naming the variable when it is malformed (%s)",
      async (supabaseUrl) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl })
        ).rejects.toThrow(
          /NEXT_PUBLIC_SUPABASE_URL: must be an http:\/\/ or https:\/\/ URL/
        )
      }
    )

    it.each([
      [
        "http off localhost",
        "http://abc.supabase.co",
        /NEXT_PUBLIC_SUPABASE_URL: must be an https:\/\/ URL \(http:\/\/ is allowed only for localhost and 127\.0\.0\.1\)/,
      ],
      [
        "a path",
        "https://abc.supabase.co/rest/v1",
        /NEXT_PUBLIC_SUPABASE_URL: must be the bare origin with no path/,
      ],
      [
        "a query string",
        "https://abc.supabase.co?x=1",
        /NEXT_PUBLIC_SUPABASE_URL: must not contain a query string/,
      ],
      [
        "a fragment",
        "https://abc.supabase.co#x",
        /NEXT_PUBLIC_SUPABASE_URL: must not contain a #fragment/,
      ],
      [
        "credentials",
        "https://user:pw@abc.supabase.co",
        /NEXT_PUBLIC_SUPABASE_URL: must not contain a username or password/,
      ],
    ])(
      "throws naming the variable for %s (%s)",
      async (_label, supabaseUrl, message) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl })
        ).rejects.toThrow(message)
      }
    )
  })

  describe("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    it("accepts a publishable key", async () => {
      const { clientEnv } = await loadClientEnv()
      expect(clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
        VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      )
    })

    it.each([undefined, ""])(
      "throws naming the variable when it is missing (%j)",
      async (key) => {
        await expect(
          loadClientEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })
        ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: missing/)
      }
    )

    it.each([
      ["a secret key", "sb_secret_fake-key-for-this-test-only"],
      [
        "a legacy JWT key",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl",
      ],
      ["the bare prefix", "sb_publishable_"],
    ])("throws naming the variable for %s", async (_label, key) => {
      await expect(
        loadClientEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })
      ).rejects.toThrow(
        /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must be a Supabase publishable key/
      )
    })
  })
})

describe(".env.example", () => {
  it("holds values the schema accepts, for every client variable", async () => {
    const example = parseEnv(
      readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
    )
    const names = Object.keys(VALID) as Name[]
    for (const name of names) expect(example).toHaveProperty(name)

    const { clientEnv, clientEnvSchema } = await loadClientEnv(
      Object.fromEntries(names.map((name) => [name, example[name]]))
    )
    // VALID (and so this test) covers every variable the schema reads.
    expect(Object.keys(clientEnvSchema.shape).sort()).toEqual([...names].sort())
    expect(clientEnv).toEqual(
      Object.fromEntries(names.map((name) => [name, example[name]]))
    )
  })
})
