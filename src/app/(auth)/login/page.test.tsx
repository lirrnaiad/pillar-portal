// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentMember } from "@/features/members"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { getCurrentMember, redirect, RedirectError, safeReturnPath } =
  vi.hoisted(() => {
    // Like Next's redirect(), the mock throws, so nothing after it runs.
    class RedirectError extends Error {
      constructor(readonly url: string) {
        super(`NEXT_REDIRECT ${url}`)
      }
    }
    return {
      getCurrentMember: vi.fn(),
      redirect: vi.fn((url: string) => {
        throw new RedirectError(url)
      }),
      RedirectError,
      // safeReturnPath has its own tests. This stand-in mirrors its string
      // check (anything but a string is /dashboard) and marks what it returns
      // for a string, so the tests can see that only its result is used.
      safeReturnPath: vi.fn((next: unknown) =>
        typeof next === "string" && next !== ""
          ? `checked:${next}`
          : "/dashboard"
      ),
    }
  })

// The persona buttons have their own tests; here only whether they render,
// and with which next.
vi.mock("@/features/members", () => ({
  getCurrentMember,
  PersonaSignIn: ({ next }: { next: string }) => (
    <div data-testid="persona-sign-in" data-next={next} />
  ),
  safeReturnPath,
}))
vi.mock("next/navigation", () => ({ redirect }))

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Head Layout Artist",
  role: "editorial_admin",
} satisfies CurrentMember

type SearchParams = Record<string, string | string[] | undefined>

// env.server reads the environment when it loads, so each test stubs it and
// imports the page afresh.
async function loadLoginPage({ personas }: { personas: string | undefined }) {
  vi.stubEnv("PROTOTYPE_PERSONAS", personas)
  vi.stubEnv("PROTOTYPE_PERSONA_PASSWORD", "a-persona-password-for-tests")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
  vi.resetModules()
  const { default: LoginPage } = await import("./page")
  return (searchParams: SearchParams = {}) =>
    LoginPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    })
}

async function renderLoginPage({
  personas,
  searchParams,
}: {
  personas: string | undefined
  searchParams?: SearchParams
}) {
  const LoginPage = await loadLoginPage({ personas })
  return render(await LoginPage(searchParams))
}

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

beforeEach(() => {
  getCurrentMember.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("LoginPage", () => {
  it("offers the persona buttons while personas are on", async () => {
    const { container } = await renderLoginPage({ personas: "true" })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sign in"
    )
    expect(
      screen.getByText("Prototype: choose who to sign in as.")
    ).toBeInTheDocument()
    expect(screen.getByTestId("persona-sign-in")).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it.each([undefined, "false"])(
    "renders no persona buttons when PROTOTYPE_PERSONAS is %j",
    async (personas) => {
      const { container } = await renderLoginPage({ personas })

      expect(screen.queryByTestId("persona-sign-in")).not.toBeInTheDocument()
      expect(
        screen.getByText("Sign-in isn't available yet.")
      ).toBeInTheDocument()
      expect(await axeViolations(container)).toEqual([])
    }
  )

  it("passes next to the persona buttons only after safeReturnPath checks it", async () => {
    await renderLoginPage({
      personas: "true",
      searchParams: { next: "/dashboard?view=board" },
    })

    expect(safeReturnPath).toHaveBeenCalledExactlyOnceWith(
      "/dashboard?view=board"
    )
    expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
      "data-next",
      "checked:/dashboard?view=board"
    )
  })

  it.each([
    ["missing", {}, undefined],
    [
      "repeated (an array)",
      { next: ["/admin", "/login"] },
      ["/admin", "/login"],
    ],
  ])(
    "gives the persona buttons /dashboard when next is %s",
    async (_label, searchParams, handedOn) => {
      await renderLoginPage({ personas: "true", searchParams })

      // The raw value goes to safeReturnPath unchanged; it decides.
      expect(safeReturnPath).toHaveBeenCalledExactlyOnceWith(handedOn)
      expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
        "data-next",
        "/dashboard"
      )
    }
  )

  it("sends an active member to /dashboard when next is repeated (an array)", async () => {
    getCurrentMember.mockResolvedValue(MEMBER)
    const LoginPage = await loadLoginPage({ personas: "true" })

    await expect(LoginPage({ next: ["/admin", "/login"] })).rejects.toEqual(
      new RedirectError("/dashboard")
    )
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard")
  })

  it.each(["staff", "editorial_admin"] as const)(
    "sends an active %s member to the checked next, with no persona buttons",
    async (role) => {
      getCurrentMember.mockResolvedValue({ ...MEMBER, role })
      const LoginPage = await loadLoginPage({ personas: "true" })

      await expect(
        LoginPage({ next: "/dashboard?view=board" })
      ).rejects.toEqual(new RedirectError("checked:/dashboard?view=board"))
      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        "checked:/dashboard?view=board"
      )
    }
  )

  it("sends an active member to /dashboard when there is no next", async () => {
    getCurrentMember.mockResolvedValue(MEMBER)
    const LoginPage = await loadLoginPage({ personas: undefined })

    await expect(LoginPage()).rejects.toEqual(new RedirectError("/dashboard"))
  })

  it.each([
    ["signed out (no member)", null],
    ["pending", { ...MEMBER, role: "pending" as const }],
  ])("renders the page as usual for a %s caller", async (_label, member) => {
    getCurrentMember.mockResolvedValue(member)
    const { container } = await renderLoginPage({
      personas: "true",
      searchParams: { next: "/dashboard?view=board" },
    })

    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
      "data-next",
      "checked:/dashboard?view=board"
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
