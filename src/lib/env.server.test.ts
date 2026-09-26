import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("serverEnv", () => {
  it("parses with an empty schema and exposes no ambient variables", async () => {
    vi.stubEnv("SOME_UNRELATED_SECRET", "canary-value-1234")
    vi.resetModules()
    const { serverEnv, serverEnvSchema } = await import("./env.server")

    expect(Object.keys(serverEnvSchema.shape)).toEqual([])
    expect(serverEnv).toEqual({})
  })
})
