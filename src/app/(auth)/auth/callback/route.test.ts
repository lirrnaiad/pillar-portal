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

  it("logs nothing after a successful exchange", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await call("?code=abc&next=%2Fdashboard")

    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each([
    [
      "the member canceled (error=access_denied)",
      "?error=access_denied&error_code=access_denied&error_description=x",
      null,
    ],
    [
      "Google or Auth sent another error",
      "?error=server_error&error_code=bad_oauth_state&error_description=OAuth+state+is+invalid&code=abc",
      {
        error: "server_error",
        error_code: "bad_oauth_state",
        error_description: "OAuth state is invalid",
      },
    ],
    [
      "Auth sent an error with nothing else",
      "?error=invalid_request",
      {
        error: "invalid_request",
        error_code: null,
        error_description: null,
      },
    ],
    ["there is no code", "", null],
    ["the code is empty", "?code=", null],
  ])(
    "goes back to /login with the error, keeping next, when %s",
    async (_label, query, logged) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      const sep = query === "" ? "?" : "&"
      const res = await call(`${query}${sep}next=%2Fdashboard%3Fview%3Dboard`)

      expect(exchangeCodeForSession).not.toHaveBeenCalled()
      expect(res.headers.get("location")).toBe(FAILED("/dashboard?view=board"))
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      if (logged === null) {
        expect(errorLog).not.toHaveBeenCalled()
      } else {
        // The three parameters only: never next, the code or anything else.
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
          "GET /auth/callback: Auth sent back an error",
          logged
        )
      }
    }
  )

  it.each([
    [
      "a refused code",
      Object.assign(
        new Error("invalid flow state, no valid flow state found"),
        {
          name: "AuthApiError",
          code: "flow_state_not_found",
          status: 404,
        }
      ),
    ],
    [
      "a missing verifier",
      Object.assign(new Error("PKCE code verifier not found in storage."), {
        name: "AuthPKCECodeVerifierMissingError",
        code: "pkce_code_verifier_not_found",
        status: 400,
      }),
    ],
  ])(
    "logs the error's name, code, status and message, then goes back to /login, after %s",
    async (_label, error) => {
      exchangeCodeForSession.mockResolvedValue({
        data: { session: null, user: null },
        error: Object.assign(error, { extra: "not logged" }),
      })
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

      const res = await call("?code=secret-code&next=%2Fdashboard%2Ftasks%2FX")

      expect(res.headers.get("location")).toBe(FAILED("/dashboard/tasks/X"))
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(errorLog).toHaveBeenCalledExactlyOnceWith(
        "GET /auth/callback: the code exchange returned an error",
        {
          name: error.name,
          code: error.code,
          status: error.status,
          message: error.message,
        }
      )
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret-code")
    }
  )

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
