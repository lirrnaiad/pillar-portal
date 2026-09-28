import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { auth, cookieStore, createClient, redirect, RedirectError } = vi.hoisted(
  () => {
    const auth = {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    }
    // This browser's cookies: the session (in two chunks), the PKCE verifier,
    // and two that aren't Supabase auth cookies.
    const cookieStore = {
      getAll: vi.fn(() =>
        [
          "sb-127-auth-token.0",
          "sb-127-auth-token.1",
          "sb-127-auth-token-code-verifier",
          "sb-127-other",
          "theme",
        ].map((name) => ({ name, value: "x" }))
      ),
      delete: vi.fn(),
    }
    // Like Next's redirect(), the mock throws, so nothing after it runs.
    class RedirectError extends Error {
      constructor(readonly url: string) {
        super(`NEXT_REDIRECT ${url}`)
      }
    }
    return {
      auth,
      cookieStore,
      createClient: vi.fn(async () => ({ auth })),
      redirect: vi.fn((url: string) => {
        throw new RedirectError(url)
      }),
      RedirectError,
    }
  }
)

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }))

const PASSWORD = "a-persona-password-for-tests"

// env.server reads the environment when it loads, so each test stubs it and
// imports the actions afresh.
async function loadActions({ personas }: { personas: string | undefined }) {
  vi.stubEnv("PROTOTYPE_PERSONAS", personas)
  vi.stubEnv("PROTOTYPE_PERSONA_PASSWORD", PASSWORD)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
  vi.resetModules()
  return import("./actions")
}

function form(fields: Record<string, string> = {}) {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  auth.signOut.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("signInAsPersonaAction", () => {
  it("signs in with the persona's email and the server-held password, then goes to /dashboard", async () => {
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "head_layout_artist" }))
    ).rejects.toThrow(RedirectError)

    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "persona-head_layout_artist@example.com",
      password: PASSWORD,
    })
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard")
  })

  it.each([undefined, "false"])(
    "returns auth.personas_off without calling Auth when PROTOTYPE_PERSONAS is %j",
    async (personas) => {
      const { signInAsPersonaAction } = await loadActions({ personas })

      await expect(
        signInAsPersonaAction(null, form({ persona: "editor_in_chief" }))
      ).resolves.toEqual({ ok: false, code: "auth.personas_off" })
      expect(createClient).not.toHaveBeenCalled()
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["missing", {}],
    ["unknown", { persona: "admin" }],
    ["a position that isn't a persona", { persona: "staff_writer" }],
    ["an inherited property name", { persona: "constructor" }],
  ])(
    "returns auth.sign_in_failed without calling Auth when the persona is %s",
    async (_label, fields) => {
      const { signInAsPersonaAction } = await loadActions({ personas: "true" })

      await expect(signInAsPersonaAction(null, form(fields))).resolves.toEqual({
        ok: false,
        code: "auth.sign_in_failed",
      })
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it("returns auth.sign_in_failed and stays on /login when Auth refuses the password", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Invalid login credentials" },
    })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "staff_layout_artist" }))
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("returns auth.sign_in_failed when Auth can't be reached", async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError("fetch failed"))
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "staff_layout_artist" }))
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe("signOutAction", () => {
  const AUTH_COOKIES = [
    "sb-127-auth-token.0",
    "sb-127-auth-token.1",
    "sb-127-auth-token-code-verifier",
  ]

  it("ends this browser's session only (scope 'local'), then goes to /login", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(signOutAction()).rejects.toThrow(RedirectError)

    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
    // supabase-js cleared the session itself.
    expect(cookieStore.delete).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
  })

  it.each([
    [
      "returns an error (the session stays in place)",
      () =>
        auth.signOut.mockResolvedValue({
          error: { name: "AuthRetryableFetchError", status: 0 },
        }),
    ],
    [
      "throws",
      () => auth.signOut.mockRejectedValue(new TypeError("fetch failed")),
    ],
  ])(
    "deletes this browser's auth cookies, then goes to /login, when signOut %s",
    async (_label, fail) => {
      fail()
      const { signOutAction } = await loadActions({ personas: "true" })

      await expect(signOutAction()).rejects.toThrow(RedirectError)

      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
      expect(cookieStore.delete.mock.calls.map(([name]) => name)).toEqual(
        AUTH_COOKIES
      )
      expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
    }
  )
})

describe("error copy", () => {
  it("maps each code to the EXPERIENCE.md copy", async () => {
    const { MEMBER_ERROR_COPY } = await import("./errors")
    expect(MEMBER_ERROR_COPY).toEqual({
      "auth.personas_off": "Persona sign-in is off.",
      "auth.sign_in_failed": "Sign-in didn't finish. Try again.",
    })
  })
})
