import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories and vi.hoisted run before this file's imports.
const { createClient, exchangeCodeForSession } = await vi.hoisted(async () => {
  // Importing next/server throws unless AsyncLocalStorage is on globalThis,
  // which the Next runtime provides and plain Node doesn't.
  const { AsyncLocalStorage } = await import("node:async_hooks")
  globalThis.AsyncLocalStorage ??= AsyncLocalStorage

  const exchangeCodeForSession = vi.fn()
  return {
    exchangeCodeForSession,
    createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
// The members barrel also carries the slice's actions, which the route
// doesn't use.
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
  signOutAction: vi.fn(),
}))

import { NextRequest } from "next/server"

import { GET } from "./route"

// The request arrives on another host: absolute URLs must come from
// NEXT_PUBLIC_SITE_URL, never from the request.
function call(query: string) {
  return GET(new NextRequest(`https://evil.example/auth/callback${query}`))
}

const FAILED = (next: string) =>
  `https://pillar.example/login?next=${encodeURIComponent(next)}&error=sign-in`

beforeEach(() => {
  exchangeCodeForSession.mockResolvedValue({
    data: { session: {}, user: {} },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("GET /auth/callback", () => {
  it("exchanges the code, then goes to the checked next", async () => {
    const res = await call(
      "?code=abc&next=%2Fdashboard%2Ftasks%2FX%3Fview%3Dboard"
    )

    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "https://pillar.example/dashboard/tasks/X?view=board"
    )
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("goes to /dashboard when there is no next", async () => {
    const res = await call("?code=abc")

    expect(res.headers.get("location")).toBe("https://pillar.example/dashboard")
  })

  it.each([
    "//evil.example",
    "https://evil.example/x",
    "/\\x",
    "/.//evil.example",
    "javascript:alert(1)",
  ])("lands on /dashboard for the hostile next %j", async (next) => {
    const res = await call(`?code=abc&next=${encodeURIComponent(next)}`)

    expect(res.headers.get("location")).toBe("https://pillar.example/dashboard")
  })

  it.each([
    [
      "the member canceled (error=access_denied)",
      "?error=access_denied&error_description=x",
    ],
    ["Google or Auth sent another error", "?error=server_error&code=abc"],
    ["there is no code", ""],
    ["the code is empty", "?code="],
  ])(
    "goes back to /login with the error, keeping next, when %s",
    async (_label, query) => {
      const sep = query === "" ? "?" : "&"
      const res = await call(`${query}${sep}next=%2Fdashboard%3Fview%3Dboard`)

      expect(exchangeCodeForSession).not.toHaveBeenCalled()
      expect(res.headers.get("location")).toBe(FAILED("/dashboard?view=board"))
      expect(res.headers.get("cache-control")).toBe("private, no-store")
    }
  )

  it.each([
    ["a refused code", { name: "AuthApiError", message: "invalid flow state" }],
    [
      "a missing verifier",
      {
        name: "AuthPKCECodeVerifierMissingError",
        message: "PKCE code verifier not found in storage.",
      },
    ],
  ])("goes back to /login with the error after %s", async (_label, error) => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error,
    })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await call("?code=abc&next=%2Fdashboard%2Ftasks%2FX")

    expect(res.headers.get("location")).toBe(FAILED("/dashboard/tasks/X"))
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(errorLog).not.toHaveBeenCalled()
  })

  it("logs a thrown exchange, then goes back to /login with the error", async () => {
    const thrown = new TypeError("fetch failed")
    exchangeCodeForSession.mockRejectedValue(thrown)
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await call("?code=abc&next=%2Fadmin")

    expect(res.headers.get("location")).toBe(FAILED("/admin"))
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(errorLog).toHaveBeenCalledOnce()
    expect(errorLog.mock.calls[0]).toContain(thrown)
  })

  it("checks a hostile next on the failure path too", async () => {
    const res = await call("?error=access_denied&next=%2F%2Fevil.example")

    expect(res.headers.get("location")).toBe(FAILED("/dashboard"))
  })
})
