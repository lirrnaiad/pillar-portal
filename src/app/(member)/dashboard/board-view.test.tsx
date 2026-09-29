// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const {
  getMyHomeScope,
  getBoardOwners,
  BoardOwnerFilter,
  TaskChangesRefresher,
} = vi.hoisted(() => ({
  getMyHomeScope: vi.fn(),
  getBoardOwners: vi.fn(),
  BoardOwnerFilter: vi.fn(({ value }: { value: string }) => (
    <p>filter shows {value}</p>
  )),
  TaskChangesRefresher: vi.fn(() => <p>refresher</p>),
}))

// BoardColumns is an async Server Component, which React can't render on the
// client: stub it, and check what it is given.
const { BoardColumns } = vi.hoisted(() => ({
  BoardColumns: vi.fn(({ filter }: { filter: unknown }) => (
    <p>columns for {JSON.stringify(filter)}</p>
  )),
}))

vi.mock("@/features/members", () => ({ getMyHomeScope }))
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return {
    BOARD_ROW_HEIGHT: board.BOARD_ROW_HEIGHT,
    ownerFilterParam: board.ownerFilterParam,
    parseOwnerFilterParam: board.parseOwnerFilterParam,
    getBoardOwners,
    BoardOwnerFilter,
    TaskChangesRefresher,
  }
})
vi.mock("./board-columns", () => ({ BoardColumns }))

import {
  Suspense,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"

import { BoardColumnsSkeleton } from "./board-skeleton"
import { BoardView } from "./board-view"

// The first element of `type` in a rendered tree, searched depth-first.
function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return undefined
  }
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node
  return findElement((node.props as { children?: ReactNode }).children, type)
}

const OWNERS = [
  { kind: "section", id: "news", name: "News" },
  { kind: "desk", id: "layout", name: "Layout" },
  { kind: "desk", id: "photo", name: "Photo" },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderView(owner: unknown) {
  return render(await BoardView({ owner }))
}

describe("BoardView", () => {
  it("has the serif h1 Board, the filter, the live refresher and the columns", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "all" })

    await renderView(undefined)

    const h1 = screen.getByRole("heading", { level: 1, name: "Board" })
    expect(h1).toHaveClass("font-heading")
    expect(screen.getByText("refresher")).toBeInTheDocument()
    expect(screen.getByText(/^filter shows/)).toBeInTheDocument()
    expect(screen.getByText(/^columns for/)).toBeInTheDocument()
  })

  it("marks its root for the wide shell", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "all" })

    const { container } = await renderView(undefined)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("uses the owner parameter when it names a filter, without asking for the home scope", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)

    await renderView("section:news")

    expect(getMyHomeScope).not.toHaveBeenCalled()
    expect(screen.getByText("filter shows section:news")).toBeInTheDocument()
    expect(BoardColumns.mock.calls[0][0]).toEqual({
      filter: { kind: "section", id: "news" },
      owners: OWNERS,
    })
  })

  it.each([
    ["a missing owner", undefined],
    ["the Writers desk", "desk:writers"],
    ["an unknown id", "nope"],
    ["a repeated owner", ["all", "articles"]],
  ])("falls back to the home scope for %s", async (_label, owner) => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "desk", id: "layout" })

    await renderView(owner)

    expect(getMyHomeScope).toHaveBeenCalledTimes(1)
    expect(screen.getByText("filter shows desk:layout")).toBeInTheDocument()
    expect(BoardColumns.mock.calls[0][0].filter).toEqual({
      kind: "desk",
      id: "layout",
    })
  })

  it("falls back to All when the home scope names no listed owner", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "desk", id: "gone" })

    await renderView(undefined)

    expect(screen.getByText("filter shows all")).toBeInTheDocument()
    expect(BoardColumns.mock.calls[0][0].filter).toEqual({ kind: "all" })
  })

  it("keys the columns' own Suspense boundary by the filter, with the filter and refresher outside it", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)

    const tree = await BoardView({ owner: "desk:photo" })
    const boundary = findElement(tree, Suspense)

    expect(boundary?.key).toBe("desk:photo")
    const props = boundary?.props as {
      fallback: ReactElement
      children: ReactNode
    }
    expect(props.fallback.type).toBe(BoardColumnsSkeleton)
    expect(findElement(props.children, BoardColumns)).toBeDefined()
    expect(findElement(props.children, BoardOwnerFilter)).toBeUndefined()
    expect(findElement(props.children, TaskChangesRefresher)).toBeUndefined()
  })

  it("lets a query failure throw", async () => {
    getBoardOwners.mockRejectedValue(new Error("boom"))
    await expect(BoardView({ owner: undefined })).rejects.toThrow("boom")

    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockRejectedValue(new Error("scope boom"))
    await expect(BoardView({ owner: undefined })).rejects.toThrow("scope boom")
  })
})
