import { describe, expect, it, vi } from "vitest"

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

import AdminIndexPage from "./page"

describe("AdminIndexPage", () => {
  it("redirects to /admin/tasks", () => {
    // The (admin) layout already gated this: reaching the page at all means
    // the caller is an active editorial_admin.
    expect(() => AdminIndexPage()).toThrow(new RedirectError("/admin/tasks"))
    expect(redirect).toHaveBeenCalledWith("/admin/tasks")
  })
})
