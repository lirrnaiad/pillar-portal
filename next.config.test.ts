import { afterEach, describe, expect, it, vi } from "vitest"

// next.config.ts imports env.client for its side effect, which is what makes
// `next dev`, `next build` and `next start` refuse a bad NEXT_PUBLIC_SITE_URL.
// These tests fail if that import is removed.
async function loadNextConfig(siteUrl: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl)
  vi.resetModules()
  return import("./next.config")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("next.config.ts", () => {
  it.each([
    ["unset", undefined],
    ["not-a-url", "not-a-url"],
  ])(
    "rejects naming NEXT_PUBLIC_SITE_URL when it is %s",
    async (_label, siteUrl) => {
      await expect(loadNextConfig(siteUrl)).rejects.toThrow(
        /NEXT_PUBLIC_SITE_URL/
      )
    }
  )

  it("loads when NEXT_PUBLIC_SITE_URL is valid", async () => {
    const config = await loadNextConfig("http://localhost:3000")
    expect(config.default).toEqual(expect.any(Object))
  })
})
