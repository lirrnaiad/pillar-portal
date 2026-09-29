// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { ExternalLink } from "./external-link"

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

afterEach(cleanup)

describe("ExternalLink", () => {
  it.each(["https://docs.example.com/brief?x=1", "http://example.com/a"])(
    "links %s in a new tab, without an opener or a referrer",
    (href) => {
      render(<ExternalLink href={href}>The brief</ExternalLink>)

      // jsdom trims the sr-only span's leading space when it computes the
      // name; a browser reads "The brief (opens in a new tab)".
      const link = screen.getByRole("link", {
        name: /^The brief ?\(opens in a new tab\)$/,
      })
      expect(link).toHaveAttribute("href", href)
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
    }
  )

  it("links the URL as parsed, so what was checked is what's linked", () => {
    render(<ExternalLink href="HTTPS://Example.com">Example</ExternalLink>)

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/"
    )
  })

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.com",
    "/dashboard",
    "example.com/brief",
    "not a url",
    "",
  ])("renders %j as plain text, not a link", (href) => {
    render(<ExternalLink href={href}>Shown as text</ExternalLink>)

    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("Shown as text")).toBeInTheDocument()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        <ExternalLink href="https://example.com">The brief</ExternalLink>
      </p>
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
