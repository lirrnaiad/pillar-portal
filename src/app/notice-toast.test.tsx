// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { toast, replace, usePathname, useSearchParams } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }),
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
  it("toasts the copy for a recognized notice on its page, once, with its id", async () => {
    useSearchParams.mockReturnValue(withNotice("admin-restricted"))

    render(<NoticeToast />)

    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith(
        "That area is for the Editorial Board.",
        { id: "notice-admin-restricted" }
      )
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("leaves focus alone for admin-restricted", async () => {
    useSearchParams.mockReturnValue(withNotice("admin-restricted"))

    render(
      <main>
        <h1 tabIndex={-1}>What&apos;s mine</h1>
        <NoticeToast />
      </main>
    )

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus()
  })

  it("toasts Task deleted. as a success on /admin/tasks, then focuses the page's h1, and strips the param", async () => {
    usePathname.mockReturnValue("/admin/tasks")
    useSearchParams.mockReturnValue(withNotice("task-deleted"))

    render(
      <>
        <h1 tabIndex={-1}>Outside main</h1>
        <main>
          <h1 tabIndex={-1}>Tasks</h1>
          <NoticeToast />
        </main>
      </>
    )

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith("Task deleted.", {
        id: "notice-task-deleted",
      })
    )
    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Tasks" })).toHaveFocus()
    expect(replace).toHaveBeenCalledExactlyOnceWith("/admin/tasks")
  })

  it.each([
    ["task-deleted", "/dashboard"],
    ["task-deleted", "/admin"],
    ["task-deleted", "/admin/tasks/extra"],
    ["admin-restricted", "/admin/tasks"],
    ["admin-restricted", "/dashboard/tasks/abc"],
  ])(
    "shows nothing for %s on %s, which isn't its page, and still strips the param",
    async (notice, pathname) => {
      usePathname.mockReturnValue(pathname)
      useSearchParams.mockReturnValue(withNotice(notice))

      render(
        <main>
          <h1 tabIndex={-1}>Some page</h1>
          <NoticeToast />
        </main>
      )

      await waitFor(() =>
        expect(replace).toHaveBeenCalledExactlyOnceWith(pathname)
      )
      expect(toast).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus()
    }
  )

  it("gives every run of the effect the same toast id, so StrictMode's second run shows no second toast", async () => {
    usePathname.mockReturnValue("/admin/tasks")
    useSearchParams.mockReturnValue(withNotice("task-deleted"))

    render(
      <StrictMode>
        <NoticeToast />
      </StrictMode>
    )

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    for (const call of toast.success.mock.calls) {
      expect(call).toEqual(["Task deleted.", { id: "notice-task-deleted" }])
    }
  })

  it("doesn't treat an Object.prototype key as a notice", async () => {
    useSearchParams.mockReturnValue(withNotice("toString"))

    render(<NoticeToast />)

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(toast).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
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
