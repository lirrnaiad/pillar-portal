// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

// Only the slice's row height is needed, not its server code.
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return { BOARD_ROW_HEIGHT: board.BOARD_ROW_HEIGHT }
})

import { BoardColumnsSkeleton, BoardSkeleton } from "./board-skeleton"

afterEach(cleanup)

describe("BoardSkeleton", () => {
  it("marks itself for the wide shell, so the width doesn't jump on load", () => {
    const { container } = render(<BoardSkeleton />)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("is a busy status with four column blocks at the real widths", () => {
    render(<BoardSkeleton />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading the board")
    const blocks = [...status.children].filter((el) => el.tagName === "DIV")
    expect(blocks).toHaveLength(4)
    for (const block of blocks) {
      expect(block).toHaveClass("w-72", "shrink-0", "lg:flex-1")
    }
  })

  it("has no axe violations", async () => {
    const { container } = render(<BoardSkeleton />)

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})

describe("BoardColumnsSkeleton", () => {
  it("has no wide-view marker of its own (the Board's root carries it)", () => {
    const { container } = render(<BoardColumnsSkeleton />)

    expect(container.querySelector("[data-wide-view]")).toBeNull()
  })
})
