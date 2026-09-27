import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants"
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const VALID = {
  NEXT_PUBLIC_SITE_URL: "https://pillar-portal-staging.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
}

type Name = keyof typeof VALID

// next.config.ts imports env.client, which is what makes `next dev`,
// `next build` and `next start` refuse a bad NEXT_PUBLIC_* value. These tests
// fail if that import is removed.
async function loadNextConfig(overrides: Partial<Record<Name, string>> = {}) {
  for (const name of Object.keys(VALID) as Name[]) {
    vi.stubEnv(name, name in overrides ? overrides[name] : VALID[name])
  }
  vi.resetModules()
  return (await import("./next.config")).default
}

async function headersFor(phase: string) {
  const config = (await loadNextConfig())(phase)
  return config.headers!()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("next.config.ts", () => {
  it.each([
    ["NEXT_PUBLIC_SITE_URL", undefined],
    ["NEXT_PUBLIC_SITE_URL", "not-a-url"],
    ["NEXT_PUBLIC_SUPABASE_URL", undefined],
    ["NEXT_PUBLIC_SUPABASE_URL", "not-a-url"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_secret_fake-key-for-this-test-only",
    ],
  ] as const)("rejects naming %s when it is %j", async (name, value) => {
    await expect(loadNextConfig({ [name]: value })).rejects.toThrow(
      new RegExp(`${name}:`)
    )
  })

  it("exports a phase function that returns a config object", async () => {
    const nextConfig = await loadNextConfig()
    expect(nextConfig).toEqual(expect.any(Function))
    expect(nextConfig(PHASE_PRODUCTION_SERVER)).toEqual(expect.any(Object))
  })

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    "serves the security headers on every path in %s",
    async (phase) => {
      const rules = await headersFor(phase)
      expect(rules).toHaveLength(1)
      expect(rules[0].source).toBe("/:path*")
      const csp = rules[0].headers.find(
        (h) => h.key === "Content-Security-Policy"
      )?.value
      expect(csp).toContain(
        "connect-src 'self' https://abcdefghijklmnop.supabase.co wss://abcdefghijklmnop.supabase.co"
      )
      expect(csp).not.toContain("'unsafe-eval'")
    }
  )

  it("adds 'unsafe-eval' for the development server only", async () => {
    const [rule] = await headersFor(PHASE_DEVELOPMENT_SERVER)
    const csp = rule.headers.find(
      (h) => h.key === "Content-Security-Policy"
    )?.value
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
  })

  it.each(["/", "/api/health", "/some/deep/page"])(
    "matches %s",
    async (pathname) => {
      const nextConfig = await loadNextConfig()
      const response = await unstable_getResponseFromNextConfig({
        url: `https://pillar-portal-staging.vercel.app${pathname}`,
        nextConfig,
      })
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'"
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("same-origin")
    }
  )
})
