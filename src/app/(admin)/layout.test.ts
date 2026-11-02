import { Suspense } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  requireAdmin,
  AdminShell,
  AdminBannerSlot,
  NoticeToast,
  OfflineToast,
  RedirectError,
} = vi.hoisted(() => {
  // Like Next's redirect(), which requireAdmin calls, the mock throws.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    requireAdmin: vi.fn(),
    AdminShell: vi.fn(() => null),
    AdminBannerSlot: vi.fn(() => null),
    NoticeToast: vi.fn(() => null),
    OfflineToast: vi.fn(() => null),
    RedirectError,
  }
})

// require-admin.test.ts covers who requireAdmin redirects, and where.
vi.mock("./require-admin", () => ({ requireAdmin }))
vi.mock("./admin-shell", () => ({ AdminShell }))
vi.mock("./admin-banners", () => ({ AdminBannerSlot }))
// notice-toast.test.tsx covers what it shows.
vi.mock("../notice-toast", () => ({ NoticeToast }))
// offline-toast.test.tsx covers when it toasts.
vi.mock("../offline-toast", () => ({ OfflineToast }))

import type { CurrentMember } from "@/features/members"

import AdminLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Editor-in-Chief",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminLayout", () => {
  it.each(["/login", "/dashboard?notice=admin-restricted"])(
    "runs the admin check, and renders nothing when it redirects to %s",
    async (url) => {
      requireAdmin.mockRejectedValue(new RedirectError(url))

      await expect(AdminLayout({ children: null })).rejects.toEqual(
        new RedirectError(url)
      )
      expect(requireAdmin).toHaveBeenCalledOnce()
      expect(AdminShell).not.toHaveBeenCalled()
      expect(AdminBannerSlot).not.toHaveBeenCalled()
    }
  )

  it("renders the admin shell with the banner slot for an active editorial_admin member, with the notice-toast reader and the offline toast mounted before the page", async () => {
    requireAdmin.mockResolvedValue(MEMBER)

    const element = await AdminLayout({ children: "page" })

    expect(element.type).toBe(AdminShell)
    expect(element.props).toEqual({
      member: MEMBER,
      banners: expect.objectContaining({ type: AdminBannerSlot, props: {} }),
      children: [
        expect.objectContaining({
          type: Suspense,
          props: expect.objectContaining({
            fallback: null,
            children: expect.objectContaining({ type: NoticeToast }),
          }),
        }),
        expect.objectContaining({ type: OfflineToast }),
        "page",
      ],
    })
    // The slot reads its sources only when React renders it, after the check.
    expect(AdminBannerSlot).not.toHaveBeenCalled()
  })
})
