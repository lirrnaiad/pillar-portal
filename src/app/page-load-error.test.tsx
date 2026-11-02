// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import AdminPageError from "./(admin)/error"
import MemberPageError from "./(member)/error"

const DIGEST = "2876418952"

// What a Server Component's throw reaches the browser as in production: a
// generic message and the digest. The message here stands in for a detail
// that must never show.
function serverError(digest?: string): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    "relation tasks: secret detail"
  )
  if (digest !== undefined) error.digest = digest
  return error
}

afterEach(() => {
  cleanup()
})

describe.each([
  ["(member)/error.tsx", MemberPageError],
  ["(admin)/error.tsx", AdminPageError],
])("%s", (_, Boundary) => {
  it("says Couldn't load this page. as the page's h1, with Try again", () => {
    render(<Boundary error={serverError(DIGEST)} retry={vi.fn()} />)

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Couldn't load this page.",
      })
    ).toHaveClass("font-heading", "text-heading", "text-navy")
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
  })

  it("calls retry once for a Try again press", async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(<Boundary error={serverError(DIGEST)} retry={retry} />)

    await user.click(screen.getByRole("button", { name: "Try again" }))

    expect(retry).toHaveBeenCalledExactlyOnceWith()
  })

  it("shows the digest as a muted Error ID line, and never the error's message", () => {
    render(<Boundary error={serverError(DIGEST)} retry={vi.fn()} />)

    expect(screen.getByText(`Error ID: ${DIGEST}`)).toHaveClass(
      "text-sm",
      "text-muted-foreground"
    )
    expect(screen.queryByText(/secret detail/)).toBeNull()
  })

  it("shows no Error ID line for an error with no digest, as a client error has", () => {
    const { container } = render(
      <Boundary error={serverError()} retry={vi.fn()} />
    )

    expect(screen.queryByText(/Error ID/)).toBeNull()
    expect(container).not.toHaveTextContent("secret detail")
  })

  it("has no axe violations", async () => {
    // Its shell's <main> holds it. color-contrast can't be computed in jsdom.
    const { container } = render(
      <main>
        <Boundary error={serverError(DIGEST)} retry={vi.fn()} />
      </main>
    )
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })

    expect(results.violations).toEqual([])
  })
})
