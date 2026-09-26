import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn with the DESIGN.md tokens", () => {
  it.each([
    [["text-display", "text-navy"], "text-display text-navy"],
    [["shadow-card", "shadow-sm"], "shadow-sm"],
    [["p-card-padding", "p-2"], "p-2"],
  ])("cn(%j) returns %j", (inputs, expected) => {
    expect(cn(...inputs)).toBe(expected)
  })

  it.each([
    [["text-sm", "text-heading-sm"], "text-heading-sm"],
    [
      ["text-status-badge", "text-status-attention-text"],
      "text-status-badge text-status-attention-text",
    ],
    [["px-4", "px-page-margin-mobile"], "px-page-margin-mobile"],
    [["gap-2", "gap-column-gap"], "gap-column-gap"],
  ])("also merges cn(%j) to %j", (inputs, expected) => {
    expect(cn(...inputs)).toBe(expected)
  })
})
