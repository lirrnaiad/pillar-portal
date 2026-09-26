import { afterEach, describe, expect, it, vi } from "vitest"

async function loadClientEnv(siteUrl: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl)
  vi.resetModules()
  return import("./env.client")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("clientEnv", () => {
  it.each([
    "https://pillar-portal-staging.vercel.app",
    "http://localhost:3000",
  ])("accepts %s", async (siteUrl) => {
    const { clientEnv } = await loadClientEnv(siteUrl)
    expect(clientEnv.NEXT_PUBLIC_SITE_URL).toBe(siteUrl)
  })

  it.each([undefined, ""])(
    "throws naming the variable when it is missing (%j)",
    async (siteUrl) => {
      await expect(loadClientEnv(siteUrl)).rejects.toThrow(
        /NEXT_PUBLIC_SITE_URL/
      )
    }
  )

  it.each(["not-a-url", "localhost:3000", "javascript:alert(1)", "ftp://x.y"])(
    "throws naming the variable when it is malformed (%s)",
    async (siteUrl) => {
      await expect(loadClientEnv(siteUrl)).rejects.toThrow(
        /NEXT_PUBLIC_SITE_URL/
      )
    }
  )
})
