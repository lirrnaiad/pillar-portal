// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentMember } from "@/features/members"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  env,
  getCurrentMember,
  redirect,
  RedirectError,
  request,
  safeReturnPath,
} = vi.hoisted(() => {
  // Like Next's redirect(), the mock throws, so nothing after it runs.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    // PROTOTYPE_PERSONAS as env.server would read it (its own tests cover
    // the parsing).
    env: { personas: undefined as string | undefined },
    getCurrentMember: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
    request: { userAgent: "" },
    // safeReturnPath has its own tests. This stand-in mirrors its string
    // check (anything but a string is /dashboard) and marks what it returns
    // for a string, so the tests can see that only its result is used.
    safeReturnPath: vi.fn((next: unknown) =>
      typeof next === "string" && next !== "" ? `checked:${next}` : "/dashboard"
    ),
  }
})

// The members slice renders for real (the account states, the in-app
// browser page, the Google button), except the caller lookup, the
// safeReturnPath stand-in, and the persona buttons, which have their own
// tests; here only whether they render, and with which next.
vi.mock("@/features/members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members")>()),
  getCurrentMember,
  PersonaSignIn: ({ next }: { next: string }) => (
    <div data-testid="persona-sign-in" data-next={next} />
  ),
  safeReturnPath,
}))
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
  signOutAction: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
// A getter, so each test sets personas without reloading the page's modules.
vi.mock("@/lib/env.server", () => ({
  get personasEnabled() {
    return env.personas === "true"
  },
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": request.userAgent }),
}))
vi.mock("next/navigation", () => ({ redirect }))

import LoginPage, { generateMetadata } from "./page"

const UA = {
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  messengerIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerLiteForiOS;FBAV/466.0.0.36.106;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/479.0.0.51.64;]",
  facebookOther:
    "Mozilla/5.0 (X11; Linux x86_64) [FBAN/FBIOS;FBAV/476.0.0.41.109]",
}

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Head Layout Artist",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

type SearchParams = Record<string, string | string[] | undefined>

async function loadLoginPage({ personas }: { personas: string | undefined }) {
  env.personas = personas
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

const googleButton = () =>
  screen.queryByRole("button", { name: "Sign in with Google" })

// The checked next, as /login?next=… on the site's own origin.
const LOGIN_URL =
  "https://pillar.example/login?next=checked%3A%2Fdashboard%2Ftasks%2FX"

beforeEach(() => {
  getCurrentMember.mockResolvedValue(null)
  request.userAgent = UA.safariIos
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("LoginPage, signed out", () => {
  it("offers Sign in with Google, then the persona buttons while personas are on", async () => {
    const { container } = await renderLoginPage({
      personas: "true",
      searchParams: { next: "/dashboard?view=board" },
    })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sign in"
    )
    const button = googleButton()!
    expect(button).toHaveAttribute("type", "submit")
    expect(button).toHaveClass("min-h-11", "w-full")
    const form = button.closest("form")!
    expect(form.querySelector('input[name="next"]')).toHaveValue(
      "checked:/dashboard?view=board"
    )
    expect(
      screen.getByText("Prototype: choose who to sign in as.")
    ).toBeInTheDocument()
    expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
      "data-next",
      "checked:/dashboard?view=board"
    )
    // Google first, personas below.
    expect(
      button.compareDocumentPosition(screen.getByTestId("persona-sign-in")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it.each([undefined, "false"])(
    "offers only Google when PROTOTYPE_PERSONAS is %j",
    async (personas) => {
      const { container } = await renderLoginPage({ personas })

      expect(googleButton()).toBeInTheDocument()
      expect(screen.queryByTestId("persona-sign-in")).not.toBeInTheDocument()
      expect(
        screen.queryByText("Sign-in isn't available yet.")
      ).not.toBeInTheDocument()
      expect(await axeViolations(container)).toEqual([])
    }
  )

  it("shows the didn't-finish line above the Google button after error=sign-in, keeping next", async () => {
    const { container } = await renderLoginPage({
      personas: undefined,
      searchParams: { next: "/dashboard/tasks/X", error: "sign-in" },
    })

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Sign-in didn't finish. Try again.")
    expect(
      alert.compareDocumentPosition(googleButton()!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      googleButton()!.closest("form")!.querySelector('input[name="next"]')
    ).toHaveValue("checked:/dashboard/tasks/X")
    expect(await axeViolations(container)).toEqual([])
  })

  it.each([["other"], [["sign-in", "sign-in"]]])(
    "shows no error line for error=%j",
    async (error) => {
      await renderLoginPage({ personas: undefined, searchParams: { error } })

      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    }
  )

  it.each([
    ["missing", {}, undefined],
    [
      "repeated (an array)",
      { next: ["/admin", "/login"] },
      ["/admin", "/login"],
    ],
  ])(
    "gives the sign-in forms /dashboard when next is %s",
    async (_label, searchParams, handedOn) => {
      await renderLoginPage({ personas: "true", searchParams })

      // The raw value goes to safeReturnPath unchanged; it decides.
      expect(safeReturnPath).toHaveBeenCalledExactlyOnceWith(handedOn)
      expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
        "data-next",
        "/dashboard"
      )
      expect(
        googleButton()!.closest("form")!.querySelector('input[name="next"]')
      ).toHaveValue("/dashboard")
    }
  )
})

describe("LoginPage, active member", () => {
  it.each(["staff", "editorial_admin"] as const)(
    "sends an active %s member to the checked next",
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

  it("sends an active member to /dashboard when next is repeated (an array)", async () => {
    getCurrentMember.mockResolvedValue(MEMBER)
    const LoginPage = await loadLoginPage({ personas: "true" })

    await expect(LoginPage({ next: ["/admin", "/login"] })).rejects.toEqual(
      new RedirectError("/dashboard")
    )
  })

  it("sends an active member on even inside an in-app browser", async () => {
    getCurrentMember.mockResolvedValue(MEMBER)
    request.userAgent = UA.messengerIos
    const LoginPage = await loadLoginPage({ personas: undefined })

    await expect(LoginPage({ next: "/x" })).rejects.toEqual(
      new RedirectError("checked:/x")
    )
  })
})

describe("LoginPage, a member who isn't active", () => {
  it.each([
    [
      "pending",
      "Awaiting approval",
      "You're signed in — a Board member will approve you shortly. Tell your editor or head you've joined.",
    ],
    [
      "declined",
      "Access declined",
      "Your access request wasn't approved. If this is a mistake, ask your editor or head.",
    ],
    [
      "deactivated",
      "No access",
      "Your access to the portal has ended. If this is a mistake, ask your editor or head.",
    ],
  ] as const)(
    "shows a %s member their state and Sign out, never redirecting",
    async (state, title, text) => {
      getCurrentMember.mockResolvedValue({
        ...MEMBER,
        role: state === "deactivated" ? "editorial_admin" : "pending",
        state,
      })
      const { container } = await renderLoginPage({
        personas: undefined,
        searchParams: { next: "/dashboard" },
      })

      expect(redirect).not.toHaveBeenCalled()
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title)
      expect(screen.getByText(text)).toBeInTheDocument()
      const signOut = screen.getByRole("button", { name: "Sign out" })
      expect(signOut).toHaveAttribute("type", "submit")
      expect(signOut).toHaveClass("min-h-11")
      // Sign out keeps the checked next for the account they switch to.
      expect(
        signOut.closest("form")!.querySelector('input[name="next"]')
      ).toHaveValue("checked:/dashboard")
      expect(googleButton()).not.toBeInTheDocument()
      expect(await axeViolations(container)).toEqual([])
    }
  )

  it("shows the state rather than the in-app hand-off, with personas below while on", async () => {
    getCurrentMember.mockResolvedValue({
      ...MEMBER,
      role: "pending",
      state: "pending",
    })
    request.userAgent = UA.messengerIos
    await renderLoginPage({ personas: "true" })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Awaiting approval"
    )
    expect(
      screen.queryByRole("link", { name: "Open in your browser" })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("persona-sign-in")).toBeInTheDocument()
  })
})

describe("LoginPage inside an in-app browser", () => {
  it("on Android, hands off to the default browser with the full /login?next= URL, and the ⋯ menu line", async () => {
    request.userAgent = UA.facebookAndroid
    const { container } = await renderLoginPage({
      personas: undefined,
      searchParams: { next: "/dashboard/tasks/X", error: "sign-in" },
    })

    expect(
      screen.getByText(
        "To sign in with Google, open this page in your browser."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open in your browser" })
    ).toHaveAttribute(
      "href",
      "intent://pillar.example/login?next=checked%3A%2Fdashboard%2Ftasks%2FX#Intent;scheme=https;action=android.intent.action.VIEW;end"
    )
    expect(
      screen.getByText(
        "Or open the ⋯ menu and choose to open this page in your browser."
      )
    ).toBeInTheDocument()
    expect(googleButton()).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Copy link" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it("on iOS, hands off to Safari, then the app's numbered steps and Copy link", async () => {
    request.userAgent = UA.messengerIos
    const { container } = await renderLoginPage({
      personas: "true",
      searchParams: { next: "/dashboard/tasks/X" },
    })

    expect(
      screen.getByRole("link", { name: "Open in your browser" })
    ).toHaveAttribute("href", `x-safari-${LOGIN_URL}`)
    const steps = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(steps.map((step) => step.textContent)).toEqual([
      "Tap ⋯ at the top right.",
      "Tap Open in Safari.",
    ])
    expect(
      screen.getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Skip this next time/)).not.toBeInTheDocument()
    expect(googleButton()).not.toBeInTheDocument()
    // Personas still render below the notice.
    expect(screen.getByTestId("persona-sign-in")).toHaveAttribute(
      "data-next",
      "checked:/dashboard/tasks/X"
    )
    expect(await axeViolations(container)).toEqual([])
  })

  it("on an unknown platform, shows the ⋯ menu line and Copy link, with no hand-off", async () => {
    request.userAgent = UA.facebookOther
    const { container } = await renderLoginPage({ personas: undefined })

    expect(
      screen.queryByRole("link", { name: "Open in your browser" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "Or open the ⋯ menu and choose to open this page in your browser."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
    expect(googleButton()).not.toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe("LoginPage's title", () => {
  it.each([
    ["pending", "pending", "Awaiting approval · The Pillar Portal"],
    ["declined", "pending", "Access declined · The Pillar Portal"],
    ["deactivated", "editorial_admin", "No access · The Pillar Portal"],
  ] as const)("names a %s member's state", async (state, role, title) => {
    getCurrentMember.mockResolvedValue({ ...MEMBER, role, state })

    await expect(generateMetadata()).resolves.toEqual({ title })
  })

  it.each([
    ["signed out", null],
    ["an active member", MEMBER],
  ])("is Sign in for %s", async (_label, member) => {
    getCurrentMember.mockResolvedValue(member)

    await expect(generateMetadata()).resolves.toEqual({
      title: "Sign in · The Pillar Portal",
    })
  })
})
