// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { redirect, RedirectError } = vi.hoisted(() => {
  // Like Next's redirect(), the mock throws, so nothing after it runs.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
  }
})

vi.mock("next/navigation", () => ({ redirect }))
// The members barrel also carries the slice's queries and actions, which the
// page doesn't use.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
  signOutAction: vi.fn(),
}))

import Page from "./page"

type SearchParams = Record<string, string | string[] | undefined>

function call(searchParams: SearchParams) {
  return Page({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("the home page, where Supabase Auth falls back", () => {
  it.each([
    ["a code", { code: "abc" }, "/auth/callback?code=abc"],
    [
      "a code needing encoding, even beside an error",
      { code: "a&b=c d", error: "server_error" },
      "/auth/callback?code=a%26b%3Dc%20d",
    ],
  ])(
    "sends %s on to /auth/callback to finish signing in",
    async (_label, searchParams, url) => {
      await expect(call(searchParams)).rejects.toEqual(new RedirectError(url))
      expect(redirect).toHaveBeenCalledExactlyOnceWith(url)
    }
  )

  it.each([
    ["an error", { error: "server_error", error_code: "bad_oauth_state" }],
    ["an empty error", { error: "" }],
    ["a repeated error", { error: ["invalid_request", "server_error"] }],
    [
      "an error beside a repeated code",
      { error: "server_error", code: ["a", "b"] },
    ],
  ])(
    "sends %s to /login with the didn't-finish line",
    async (_label, searchParams) => {
      const url = "/login?next=%2Fdashboard&error=sign-in"

      await expect(call(searchParams)).rejects.toEqual(new RedirectError(url))
      expect(redirect).toHaveBeenCalledExactlyOnceWith(url)
    }
  )

  it("renders the placeholder otherwise", async () => {
    render(await call({ next: "/dashboard" }))

    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The Pillar Portal"
    )
    expect(
      screen.getByText("The portal is being built. Check back soon.")
    ).toBeInTheDocument()
  })
})
