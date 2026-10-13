import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { redirect, RedirectError, requireAdmin } = vi.hoisted(() => {
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
    requireAdmin: vi.fn(),
  }
})

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("../require-admin", () => ({ requireAdmin }))

import AdminIndexPage from "./page"

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminIndexPage", () => {
  it("redirects an admin to /admin/tasks", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })

    await expect(AdminIndexPage()).rejects.toEqual(
      new RedirectError("/admin/tasks")
    )
    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/admin/tasks")
  })

  it("runs the admin check first: its redirect wins", async () => {
    requireAdmin.mockRejectedValue(new RedirectError("/login"))

    await expect(AdminIndexPage()).rejects.toEqual(new RedirectError("/login"))
    expect(redirect).not.toHaveBeenCalled()
  })
})
