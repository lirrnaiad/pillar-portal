// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { StatusBadge, StatusDot } from "./status-badge"

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

afterEach(cleanup)

describe("StatusBadge", () => {
  it.each([
    ["neutral", "bg-status-neutral-tint", "text-status-neutral-text"],
    ["progress", "bg-status-progress-tint", "text-status-progress-text"],
    ["positive", "bg-status-positive-tint", "text-status-positive-text"],
    ["attention", "bg-status-attention-tint", "text-status-attention-text"],
  ] as const)(
    "shows its label on the %s tint, named Status: <label>",
    (family, tint, text) => {
      render(<StatusBadge family={family} label="Needs reassignment" />)

      const badge = screen.getByRole("img", {
        name: "Status: Needs reassignment",
      })
      expect(badge).toHaveTextContent("Needs reassignment")
      expect(badge).toHaveClass(tint, text, "rounded-full", "text-status-badge")
      expect(badge.className).not.toMatch(/\b(border|outline|ring)\b/)
    }
  )

  it("shows the label untinted for the none family", () => {
    render(<StatusBadge family="none" label="On it" />)

    const badge = screen.getByRole("img", { name: "Status: On it" })
    expect(badge).toHaveTextContent("On it")
    expect(badge.className).not.toMatch(/\bbg-/)
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        <StatusBadge family="neutral" label="Awaiting response" />
      </p>
    )
    expect(await axeViolations(container)).toEqual([])
  })
})

describe("StatusDot", () => {
  it("shows an 8px dot in the family's color beside its label", () => {
    const { container } = render(<StatusDot family="progress" label="Doing" />)

    const dot = container.querySelector('[data-family="progress"]')
    expect(dot).toHaveClass("size-2", "rounded-full", "bg-status-progress")
    expect(dot).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("Doing")).toBeInTheDocument()
  })

  it("shows the label alone for the none family", () => {
    const { container } = render(<StatusDot family="none" label="On it" />)

    expect(container.querySelector("[data-family]")).toBeNull()
    expect(screen.getByText("On it")).toBeInTheDocument()
  })

  it("has no axe violations", async () => {
    const { container } = render(<StatusDot family="positive" label="Done" />)
    expect(await axeViolations(container)).toEqual([])
  })
})
