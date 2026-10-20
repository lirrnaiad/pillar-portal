import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  auth,
  cookieStore,
  createClient,
  redirect,
  RedirectError,
  revalidatePath,
  rpc,
} = vi.hoisted(() => {
  const auth = {
    signInWithOAuth: vi.fn(),
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
  const rpc = vi.fn()
  return {
    auth,
    cookieStore,
    createClient: vi.fn(async () => ({ auth, rpc })),
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
    revalidatePath: vi.fn(),
    rpc,
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }))
vi.mock("next/cache", () => ({ revalidatePath }))
// safeReturnPath checks `next` against the site's origin.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

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

const AUTHORIZE_URL =
  "http://127.0.0.1:54321/auth/v1/authorize?provider=google&code_challenge=x"

beforeEach(() => {
  auth.signInWithOAuth.mockResolvedValue({
    data: { provider: "google", url: AUTHORIZE_URL },
    error: null,
  })
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  auth.signOut.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.clearAllMocks()
  // Puts back console.error after the tests that spy on it.
  vi.restoreAllMocks()
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

  it("goes to the form's next after signing in", async () => {
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "staff_layout_artist", next: "/dashboard?view=board" })
      )
    ).rejects.toEqual(new RedirectError("/dashboard?view=board"))

    expect(auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard?view=board")
  })

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", ""])(
    "goes to /dashboard instead of the hostile next %j",
    async (next) => {
      const { signInAsPersonaAction } = await loadActions({ personas: "true" })

      await expect(
        signInAsPersonaAction(null, form({ persona: "editor_in_chief", next }))
      ).rejects.toEqual(new RedirectError("/dashboard"))
      expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard")
    }
  )

  it("doesn't use next when sign-in fails", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Invalid login credentials" },
    })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "staff_layout_artist", next: "/dashboard?view=board" })
      )
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
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

describe("signInWithGoogleAction", () => {
  it("starts Google sign-in with the callback carrying the checked next, then goes to Supabase", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(
      signInWithGoogleAction(form({ next: "/dashboard/tasks/X?a=1&b=2" }))
    ).rejects.toEqual(new RedirectError(AUTHORIZE_URL))

    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: {
        redirectTo:
          "https://pillar.example/auth/callback?next=%2Fdashboard%2Ftasks%2FX%3Fa%3D1%26b%3D2",
        queryParams: { prompt: "select_account" },
      },
    })
    expect(redirect).toHaveBeenCalledExactlyOnceWith(AUTHORIZE_URL)
  })

  it("never asks the client to skip its redirect: on the server there is none", async () => {
    const { signInWithGoogleAction } = await loadActions({
      personas: undefined,
    })

    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    const [{ options }] = auth.signInWithOAuth.mock.calls[0]
    expect(options).not.toHaveProperty("skipBrowserRedirect")
    expect(Object.keys(options)).toEqual(["redirectTo", "queryParams"])
  })

  it("asks Google for its account chooser, so after Sign out another account can sign in", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    expect(auth.signInWithOAuth.mock.calls[0][0].options.queryParams).toEqual({
      prompt: "select_account",
    })
  })

  it("logs nothing when sign-in starts", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form())).rejects.toEqual(
      new RedirectError(AUTHORIZE_URL)
    )
    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/.//evil.example",
    "",
  ])("carries /dashboard instead of the hostile next %j", async (next) => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form({ next }))).rejects.toThrow(
      RedirectError
    )
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      "https://pillar.example/auth/callback?next=%2Fdashboard"
    )
  })

  it("works with personas off: Google doesn't depend on them", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "false" })

    await expect(signInWithGoogleAction(form())).rejects.toEqual(
      new RedirectError(AUTHORIZE_URL)
    )
  })

  const THROWN = new TypeError("boom")

  it.each([
    [
      "returns an error",
      () =>
        auth.signInWithOAuth.mockResolvedValue({
          data: { provider: "google", url: null },
          error: Object.assign(new Error("Unsupported provider"), {
            name: "AuthApiError",
            code: "validation_failed",
            status: 400,
            // Anything else on the error stays out of the log.
            extra: "not logged",
          }),
        }),
      [
        "signInWithGoogleAction: signInWithOAuth returned an error",
        {
          name: "AuthApiError",
          code: "validation_failed",
          status: 400,
          message: "Unsupported provider",
        },
      ],
    ],
    [
      "returns no url",
      () =>
        auth.signInWithOAuth.mockResolvedValue({
          data: { provider: "google", url: null },
          error: null,
        }),
      null,
    ],
    [
      "throws",
      () => auth.signInWithOAuth.mockRejectedValue(THROWN),
      ["signInWithGoogleAction: signInWithOAuth threw", THROWN],
    ],
  ])(
    "goes back to /login with the error and next when signInWithOAuth %s",
    async (_label, fail, logged) => {
      fail()
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      const { signInWithGoogleAction } = await loadActions({ personas: "true" })

      await expect(
        signInWithGoogleAction(form({ next: "/dashboard?view=board" }))
      ).rejects.toEqual(
        new RedirectError(
          "/login?next=%2Fdashboard%3Fview%3Dboard&error=sign-in"
        )
      )
      expect(redirect).toHaveBeenCalledOnce()
      if (logged === null) {
        expect(errorLog).not.toHaveBeenCalled()
      } else {
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(...logged)
      }
    }
  )
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

  it("goes to plain /login for a form with no next field (MemberMenu's)", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(signOutAction(form())).rejects.toThrow(RedirectError)

    expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
  })

  it("comes back to /login keeping the form's next (an account-state screen's)", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(
      signOutAction(form({ next: "/dashboard/tasks/X?view=board" }))
    ).rejects.toThrow(RedirectError)

    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard%2Ftasks%2FX%3Fview%3Dboard"
    )
  })

  it("keeps next after a failed sign-out too, once its cookies are gone", async () => {
    auth.signOut.mockRejectedValue(new TypeError("fetch failed"))
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(
      signOutAction(form({ next: "/dashboard/tasks/X" }))
    ).rejects.toThrow(RedirectError)

    expect(cookieStore.delete.mock.calls.map(([name]) => name)).toEqual(
      AUTH_COOKIES
    )
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard%2Ftasks%2FX"
    )
  })

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", ""])(
    "keeps /dashboard instead of the hostile next %j",
    async (next) => {
      const { signOutAction } = await loadActions({ personas: "true" })

      await expect(signOutAction(form({ next }))).rejects.toThrow(RedirectError)

      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        "/login?next=%2Fdashboard"
      )
    }
  )
})

describe("error copy", () => {
  it("maps each code to the EXPERIENCE.md copy", async () => {
    const { MEMBER_ERROR_COPY } = await import("./errors")
    const stale =
      "Something changed since you opened this. Review the latest and try again."
    expect(MEMBER_ERROR_COPY).toEqual({
      "auth.personas_off": "Persona sign-in is off.",
      "auth.sign_in_failed": "Sign-in didn't finish. Try again.",
      "auth.not_active": "Sign in to do that.",
      "members.stale": stale,
      "members.not_found": stale,
      "members.save_failed": "Couldn't save — try again.",
    })
  })
})

const MEMBER_ID = "00000000-0000-4000-8000-000000000041"

const APPROVAL = {
  memberId: MEMBER_ID,
  positions: ["head_photojournalist", "staff_photojournalist"],
  primaryPosition: "staff_photojournalist",
}

describe("approveMemberAction", () => {
  it("calls approve_member with the positions and primary, revalidates the admin area and returns the member id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { approveMemberAction } = await loadActions({ personas: "true" })

    await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
      ok: true,
      data: { memberId: MEMBER_ID },
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("approve_member", {
      member_id: MEMBER_ID,
      positions: ["head_photojournalist", "staff_photojournalist"],
      primary_position: "staff_photojournalist",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/admin", "layout")
  })

  it.each([
    ["no input", undefined],
    ["a member id that isn't a uuid", { ...APPROVAL, memberId: "nope" }],
    ["no positions", { ...APPROVAL, positions: [] }],
    [
      "Editor-in-Chief",
      {
        ...APPROVAL,
        positions: ["editor_in_chief"],
        primaryPosition: "editor_in_chief",
      },
    ],
    [
      "Editor-in-Chief beside another position",
      { ...APPROVAL, positions: ["staff_writer", "editor_in_chief"] },
    ],
    [
      "a position that isn't a slug",
      {
        ...APPROVAL,
        positions: ["Staff Writer"],
        primaryPosition: "Staff Writer",
      },
    ],
    [
      "more positions than are offered",
      {
        ...APPROVAL,
        positions: Array.from({ length: 22 }, (_, n) => `position_${n}`),
        primaryPosition: "position_0",
      },
    ],
    [
      "a primary that isn't among the positions",
      { ...APPROVAL, primaryPosition: "staff_writer" },
    ],
    ["no primary", { ...APPROVAL, primaryPosition: undefined }],
  ])(
    "returns members.save_failed without calling the database for %s",
    async (_label, input) => {
      const { approveMemberAction } = await loadActions({ personas: "true" })

      await expect(approveMemberAction(input)).resolves.toEqual({
        ok: false,
        code: "members.save_failed",
      })
      expect(createClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each(["auth.not_active", "members.stale", "members.not_found"])(
    "maps the database's %s straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { approveMemberAction } = await loadActions({ personas: "true" })

      await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
        ok: false,
        code: message,
      })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    "members.not_admin",
    "members.no_positions",
    "members.invalid_position",
    "members.invalid_primary",
    "permission denied for function approve_member",
  ])("maps %j to members.save_failed", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { approveMemberAction } = await loadActions({ personas: "true" })

    await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
  })
})

describe("declineMemberAction", () => {
  it("calls decline_member, revalidates the admin area and returns the member id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { declineMemberAction } = await loadActions({ personas: "true" })

    await expect(declineMemberAction({ memberId: MEMBER_ID })).resolves.toEqual(
      { ok: true, data: { memberId: MEMBER_ID } }
    )
    expect(rpc).toHaveBeenCalledExactlyOnceWith("decline_member", {
      member_id: MEMBER_ID,
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/admin", "layout")
  })

  it.each([
    ["no input", undefined],
    ["no member id", {}],
    ["a member id that isn't a uuid", { memberId: "123" }],
  ])(
    "returns members.save_failed without calling the database for %s",
    async (_label, input) => {
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(declineMemberAction(input)).resolves.toEqual({
        ok: false,
        code: "members.save_failed",
      })
      expect(createClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it.each(["auth.not_active", "members.stale", "members.not_found"])(
    "maps the database's %s straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(
        declineMemberAction({ memberId: MEMBER_ID })
      ).resolves.toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each(["members.not_admin", "connection refused"])(
    "maps %j to members.save_failed",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(
        declineMemberAction({ memberId: MEMBER_ID })
      ).resolves.toEqual({ ok: false, code: "members.save_failed" })
    }
  )
})
