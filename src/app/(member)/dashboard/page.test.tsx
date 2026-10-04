// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// The views are async Server Components, which React can't render on the
// client, so their modules are stubbed; what's under test is which one the
// page picks and what it passes. vi.mock factories run before this file's
// imports, so the stubs the tests inspect are vi.hoisted.
const { BoardView, PlannerView, WhatsMineView } = vi.hoisted(() => ({
  BoardView: vi.fn(({ owner }: { owner: unknown }) => (
    <p>board view, owner={String(owner)}</p>
  )),
  PlannerView: vi.fn(({ month, scope }: { month: unknown; scope: unknown }) => (
    <p>
      planner view, month={String(month)}, scope={String(scope)}
    </p>
  )),
  WhatsMineView: vi.fn(() => <p>whats mine view</p>),
}))

vi.mock("./board-view", () => ({ BoardView }))
vi.mock("./planner-view", () => ({ PlannerView }))
vi.mock("./whats-mine-view", () => ({ WhatsMineView }))
// The Board's skeleton reads the row height from the slice; only that is
// needed here, not the slice's server code.
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return { BOARD_ROW_HEIGHT: board.BOARD_ROW_HEIGHT }
})

import type { ReactElement } from "react"

import { BoardSkeleton } from "./board-skeleton"
import DashboardPage, { generateMetadata } from "./page"
import { PlannerSkeleton } from "./planner-skeleton"
import { WhatsMineSkeleton } from "./whats-mine-skeleton"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

type Search = Record<string, string | string[] | undefined>

// PageProps<"/dashboard"> is Next's generated type: no params on this route.
const props = (search: Search) =>
  ({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(search),
  }) as Parameters<typeof DashboardPage>[0]

describe("generateMetadata", () => {
  it("titles the Board view", async () => {
    await expect(generateMetadata(props({ view: "board" }))).resolves.toEqual({
      title: "Board · The Pillar Portal",
    })
  })

  it("titles the Planner view", async () => {
    await expect(generateMetadata(props({ view: "planner" }))).resolves.toEqual(
      {
        title: "Planner · The Pillar Portal",
      }
    )
  })

  it.each([
    ["no view", {}],
    ["an unknown view", { view: "calendar" }],
    ["a repeated view", { view: ["board", "board"] }],
    ["a repeated planner view", { view: ["planner", "planner"] }],
  ])("titles What's mine for %s", async (_label, search) => {
    await expect(generateMetadata(props(search))).resolves.toEqual({
      title: "What's mine · The Pillar Portal",
    })
  })
})

describe("DashboardPage", () => {
  it("renders the Board for ?view=board, handing it the raw owner", async () => {
    render(await DashboardPage(props({ view: "board", owner: "desk:photo" })))

    expect(screen.getByText("board view, owner=desk:photo")).toBeInTheDocument()
    expect(WhatsMineView).not.toHaveBeenCalled()
    expect(PlannerView).not.toHaveBeenCalled()
  })

  it("renders the Planner for ?view=planner, handing it the raw month and scope", async () => {
    render(
      await DashboardPage(
        props({ view: "planner", month: "2026-11", scope: "home" })
      )
    )

    expect(
      screen.getByText("planner view, month=2026-11, scope=home")
    ).toBeInTheDocument()
    expect(BoardView).not.toHaveBeenCalled()
    expect(WhatsMineView).not.toHaveBeenCalled()
  })

  it("hands the Planner a repeated month as it came, for the parser to refuse", async () => {
    render(
      await DashboardPage(
        props({ view: "planner", month: ["2026-11", "2026-12"] })
      )
    )

    expect(PlannerView.mock.calls[0][0]).toEqual({
      month: ["2026-11", "2026-12"],
      scope: undefined,
    })
  })

  // Each view loads under its own keyed boundary with its own skeleton, so a
  // switch shows the right one (the Board's carries data-wide-view).
  it.each([
    ["the Board", { view: "board" }, "board", BoardSkeleton],
    ["the Planner", { view: "planner" }, "planner", PlannerSkeleton],
    ["What's mine", {}, "whats-mine", WhatsMineSkeleton],
  ])(
    "gives %s its own keyed Suspense and skeleton",
    async (_label, search, key, skeleton) => {
      const element = (await DashboardPage(props(search))) as ReactElement<{
        fallback: ReactElement
      }>

      expect(element.key).toBe(key)
      expect(element.props.fallback.type).toBe(skeleton)
    }
  )

  it("hands the Board a repeated owner as it came, for the parser to refuse", async () => {
    render(
      await DashboardPage(props({ view: "board", owner: ["all", "articles"] }))
    )

    expect(BoardView.mock.calls[0][0]).toEqual({ owner: ["all", "articles"] })
  })

  it.each([
    ["no view", {}],
    ["an unknown view", { view: "calendar" }],
    ["a repeated view", { view: ["board", "board"] }],
    ["a repeated planner view", { view: ["planner", "planner"] }],
  ])("renders What's mine for %s", async (_label, search) => {
    render(await DashboardPage(props(search)))

    expect(screen.getByText("whats mine view")).toBeInTheDocument()
    expect(BoardView).not.toHaveBeenCalled()
    expect(PlannerView).not.toHaveBeenCalled()
  })
})
