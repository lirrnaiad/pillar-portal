import type {
  ClientRect,
  KeyboardCoordinateGetter,
  SensorContext,
} from "@dnd-kit/core"
import { describe, expect, it } from "vitest"

import {
  BOARD_KEYBOARD_CODES,
  boardCollisionDetection,
  columnJumpCoordinates,
  createBoardAnnouncements,
  dropColumn,
} from "./board-dnd"

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

describe("dropColumn", () => {
  it("returns an allowed column", () => {
    expect(dropColumn(["doing", "for_review"], "doing")).toBe("doing")
  })

  it.each([
    ["a column the card may not move to", ["doing"], "done"],
    ["the card's own column (never in allowedMoves)", ["doing"], "to_do"],
    ["outside any column", ["doing"], null],
    ["something that isn't a column", ["doing"], "task-1"],
    ["a card with no moves", [], "doing"],
  ] as const)("returns null for %s", (_label, moves, over) => {
    expect(dropColumn(moves, over)).toBeNull()
  })
})

describe("BOARD_KEYBOARD_CODES", () => {
  it("starts on Space only, so Enter on the link still opens the task", () => {
    expect(BOARD_KEYBOARD_CODES.start).toEqual(["Space"])
    expect(BOARD_KEYBOARD_CODES.end).toEqual(["Space", "Enter", "NumpadEnter"])
  })

  it("cancels on Escape and Tab, so Tab never drops", () => {
    expect(BOARD_KEYBOARD_CODES.cancel).toEqual(["Escape", "Tab"])
    expect(BOARD_KEYBOARD_CODES.end).not.toContain("Tab")
  })
})

describe("columnJumpCoordinates", () => {
  // Four 100px columns 10px apart; the card (60px wide) sits in the first.
  const COLUMNS = {
    to_do: rect(0, 0, 100, 400),
    doing: rect(110, 0, 100, 400),
    for_review: rect(220, 0, 100, 400),
    done: rect(330, 0, 100, 400),
  }
  const CARD = rect(20, 50, 60, 80)

  function jump(
    code: string,
    enabled: (keyof typeof COLUMNS)[],
    collisionRect = CARD
  ) {
    const droppableRects = new Map(enabled.map((id) => [id, COLUMNS[id]]))
    return (columnJumpCoordinates as KeyboardCoordinateGetter)(
      { code } as KeyboardEvent,
      {
        active: "task-1",
        currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
        context: { collisionRect, droppableRects } as unknown as SensorContext,
      }
    )
  }

  it("→ centres the card in the nearest enabled column on the right", () => {
    // Doing and Done are enabled; Doing is nearer.
    expect(jump("ArrowRight", ["doing", "done"])).toEqual({
      x: 110 + (100 - 60) / 2,
      y: 0,
    })
  })

  it("skips a disabled column between", () => {
    expect(jump("ArrowRight", ["done"])).toEqual({ x: 330 + 20, y: 0 })
  })

  it("← goes to the nearest enabled column on the left", () => {
    const fromDone = rect(350, 50, 60, 80)
    expect(jump("ArrowLeft", ["to_do", "doing"], fromDone)).toEqual({
      x: 110 + 20,
      y: 0,
    })
  })

  it("returns undefined when no column is that way", () => {
    expect(jump("ArrowLeft", ["doing"])).toBeUndefined()
    expect(jump("ArrowRight", [])).toBeUndefined()
  })

  it("returns undefined for other keys, or with no rect", () => {
    expect(jump("ArrowDown", ["doing"])).toBeUndefined()
    expect(jump("Space", ["doing"])).toBeUndefined()
    const noRect = (columnJumpCoordinates as KeyboardCoordinateGetter)(
      { code: "ArrowRight" } as KeyboardEvent,
      {
        active: "task-1",
        currentCoordinates: { x: 0, y: 0 },
        context: {
          collisionRect: null,
          droppableRects: new Map([["doing", COLUMNS.doing]]),
        } as unknown as SensorContext,
      }
    )
    expect(noRect).toBeUndefined()
  })
})

describe("boardCollisionDetection", () => {
  const droppableRects = new Map([
    ["doing", rect(110, 0, 100, 400)],
    ["done", rect(330, 0, 100, 400)],
  ])
  const droppableContainers = [...droppableRects.keys()].map((id) => ({
    id,
    key: id,
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: droppableRects.get(id)! },
  }))
  const base = {
    active: {} as never,
    droppableRects,
    droppableContainers: droppableContainers as never,
  }

  it("follows the pointer when there is one, whatever the rect overlaps", () => {
    // The dragged rect overlaps Doing, but the pointer is inside Done.
    const collisions = boardCollisionDetection({
      ...base,
      collisionRect: rect(120, 10, 60, 80),
      pointerCoordinates: { x: 350, y: 100 },
    })
    expect(collisions.map((c) => c.id)).toEqual(["done"])
  })

  it("follows the rect for the keyboard (no pointer)", () => {
    const collisions = boardCollisionDetection({
      ...base,
      collisionRect: rect(120, 10, 60, 80),
      pointerCoordinates: null,
    })
    expect(collisions.map((c) => c.id)).toEqual(["doing"])
  })

  it("finds nothing when the pointer is outside every column", () => {
    expect(
      boardCollisionDetection({
        ...base,
        collisionRect: rect(120, 10, 60, 80),
        pointerCoordinates: { x: 900, y: 900 },
      })
    ).toEqual([])
  })
})

describe("createBoardAnnouncements", () => {
  const announce = createBoardAnnouncements(() => "Lay out the spread")
  const active = { id: "task-1" } as never
  const over = (id: string) => ({ id }) as never

  it("names the task and the column", () => {
    expect(announce.onDragStart({ active })).toBe(
      "Picked up Lay out the spread."
    )
    expect(announce.onDragOver({ active, over: over("doing") } as never)).toBe(
      "Lay out the spread is over Doing."
    )
    expect(
      announce.onDragEnd({ active, over: over("for_review") } as never)
    ).toBe("Moving Lay out the spread to For Review.")
  })

  it("says so when nothing moved or the drag was cancelled", () => {
    expect(announce.onDragEnd({ active, over: null } as never)).toBe(
      "Lay out the spread was not moved."
    )
    expect(announce.onDragCancel({ active, over: null } as never)).toBe(
      "Moving Lay out the spread was cancelled."
    )
    expect(announce.onDragOver({ active, over: null } as never)).toBe(
      "Lay out the spread is not over a column it can move to."
    )
  })
})
