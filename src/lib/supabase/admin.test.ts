import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted. The keys are built at runtime so no
// key-shaped literal sits in the source (GitHub's push protection blocks
// Supabase secrets).
const { createClient, SECRET_KEY, PUBLISHABLE_KEY } = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  SECRET_KEY: "sb_secret_" + "a-key-for-these-tests-only",
  PUBLISHABLE_KEY: "sb_publishable_" + "a-key-for-these-tests-only",
}))

vi.mock("@supabase/supabase-js", () => ({ createClient }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SITE_URL: "https://pillar.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.example",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  },
}))
vi.mock("@/lib/env.server", () => ({
  serverEnv: { SUPABASE_SECRET_KEY: SECRET_KEY },
}))

import { createAdminClient } from "./admin"

afterEach(() => {
  vi.clearAllMocks()
})

describe("createAdminClient", () => {
  it("builds a session-less client on the site's Supabase URL with the secret key", () => {
    createAdminClient()

    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      "https://project.supabase.example",
      SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    )
  })

  it("never uses the publishable key", () => {
    createAdminClient()

    expect(JSON.stringify(createClient.mock.calls)).not.toContain(
      PUBLISHABLE_KEY
    )
  })

  it("returns the client it built", () => {
    const client = { rpc: vi.fn() }
    createClient.mockReturnValueOnce(client)

    expect(createAdminClient()).toBe(client)
  })
})
