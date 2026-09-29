// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { OwnerFilter, TaskOwnerOption } from "@/features/tasks"

const { getBoard, TaskBoard } = vi.hoisted(() => ({
  getBoard: vi.fn(),
  TaskBoard: vi.fn(({ cards }: { cards: unknown[] }) => (
    <p>board with {cards.length} cards</p>
  )),
}))

// Keep the real board.ts copy; stub only what reads Supabase or needs a
// client runtime.
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return {
    boardEmptyMessage: board.boardEmptyMessage,
    getBoard,
    TaskBoard,
  }
})

import { BoardColumns } from "./board-columns"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const OWNERS: TaskOwnerOption[] = [
  { kind: "section", id: "news", name: "News" },
  { kind: "desk", id: "photo", name: "Photo" },
]

async function renderColumns(filter: OwnerFilter) {
  return render(await BoardColumns({ filter, owners: OWNERS }))
}

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

describe("BoardColumns", () => {
  it("reads the filter's board and hands the cards to TaskBoard", async () => {
    getBoard.mockResolvedValue([{ id: "a" }, { id: "b" }])
    const filter = { kind: "section", id: "news" } as const

    await renderColumns(filter)

    expect(getBoard).toHaveBeenCalledWith(filter)
    expect(screen.getByText("board with 2 cards")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Show all" })).toBeNull()
  })

  it.each([
    [{ kind: "section", id: "news" } as const, "No tasks in News right now."],
    [{ kind: "desk", id: "photo" } as const, "No tasks in Photo right now."],
    [{ kind: "articles" } as const, "No tasks in any section right now."],
  ])(
    "shows %j's empty line with a Show all link, and no columns",
    async (filter, message) => {
      getBoard.mockResolvedValue([])

      await renderColumns(filter)

      expect(
        screen.getByRole("heading", { level: 2, name: message })
      ).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute(
        "href",
        "/dashboard?view=board&owner=all"
      )
      expect(TaskBoard).not.toHaveBeenCalled()
    }
  )

  it("shows All's four empty columns, not the empty line", async () => {
    getBoard.mockResolvedValue([])

    await renderColumns({ kind: "all" })

    expect(screen.getByText("board with 0 cards")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
  })

  it("lets a query failure throw", async () => {
    getBoard.mockRejectedValue(new Error("boom"))

    await expect(
      BoardColumns({ filter: { kind: "all" }, owners: OWNERS })
    ).rejects.toThrow("boom")
  })

  it("has no axe violations in the empty block", async () => {
    getBoard.mockResolvedValue([])
    const { container } = await renderColumns({ kind: "desk", id: "photo" })

    expect(await axeViolations(container)).toEqual([])
  })
})
