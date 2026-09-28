// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { toast, replace, usePathname, useSearchParams } = vi.hoisted(() => ({
  toast: vi.fn(),
  replace: vi.fn(),
  usePathname: vi.fn(() => "/dashboard"),
  useSearchParams: vi.fn(),
}))

vi.mock("sonner", () => ({ toast }))
vi.mock("next/navigation", () => ({
  usePathname,
  useRouter: () => ({ replace }),
  useSearchParams,
}))

import { NoticeToast } from "./notice-toast"

function withNotice(notice: string | null) {
  const params = new URLSearchParams()
  if (notice) params.set("notice", notice)
  return params
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  usePathname.mockReturnValue("/dashboard")
})

describe("NoticeToast", () => {
  it("toasts the copy for a recognized notice, once", async () => {
    useSearchParams.mockReturnValue(withNotice("admin-restricted"))

    render(<NoticeToast />)

    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith(
        "That area is for the Editorial Board."
      )
    )
  })

  it("strips the notice param via router.replace, keeping any other query", async () => {
    useSearchParams.mockReturnValue(
      new URLSearchParams("notice=admin-restricted&view=board")
    )

    render(<NoticeToast />)

    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith("/dashboard?view=board")
    )
  })

  it("replaces with the bare path when no other query remains", async () => {
    useSearchParams.mockReturnValue(withNotice("admin-restricted"))

    render(<NoticeToast />)

    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith("/dashboard")
    )
  })

  it("does nothing when there's no notice param", () => {
    useSearchParams.mockReturnValue(withNotice(null))

    render(<NoticeToast />)

    expect(toast).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it("strips an unrecognized notice value without toasting", async () => {
    useSearchParams.mockReturnValue(withNotice("something-unknown"))

    render(<NoticeToast />)

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(toast).not.toHaveBeenCalled()
  })

  it("renders nothing", () => {
    useSearchParams.mockReturnValue(withNotice(null))

    const { container } = render(<NoticeToast />)

    expect(container).toBeEmptyDOMElement()
  })
})
