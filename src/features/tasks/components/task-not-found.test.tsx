// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { TaskNotFound } from "./task-not-found"

afterEach(() => {
  cleanup()
})

describe("TaskNotFound", () => {
  it("says the task was deleted or the link is wrong, with a link back to What's mine", () => {
    render(<TaskNotFound />)

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This task was deleted or the link is wrong.",
      })
    ).toBeInTheDocument()
    const back = screen.getByRole("link", { name: "Back to What's mine" })
    expect(back).toHaveAttribute("href", "/dashboard")
    expect(back).toHaveClass("min-h-11")
  })

  it("has no axe violations", async () => {
    // Task detail and the edit page render it inside their shell's <main>,
    // which isn't here. color-contrast can't be computed in jsdom.
    const { container } = render(<TaskNotFound />)
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })

    expect(results.violations).toEqual([])
  })
})
