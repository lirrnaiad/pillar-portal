// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BoardCard } from "../queries/board"
import { TaskBoard } from "./task-board"

// jsdom has no layout, so a real pointer or keyboard drag can't be driven here.
// Instead the real DndContext is wrapped to capture the handlers TaskBoard
// gives it, and the tests call them as dnd-kit would. That exercises
// TaskBoard's own drag logic: which drops move a card, the pending rule, focus
// and the click guard. The pure helpers are tested in board-dnd.test.ts.
type DragHandlers = {
  onDragStart: (event: unknown) => void
  onDragOver: (event: unknown) => void
  onDragEnd: (event: unknown) => void
  onDragCancel: (event: unknown) => void
}

const {
  dnd,
  moveTaskAction,
  markDoneAction,
  refresh,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  dnd: { current: null as DragHandlers | null },
  moveTaskAction: vi.fn(),
  markDoneAction: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    DndContext: (props: DragHandlers & Record<string, unknown>) => {
      dnd.current = props
      return createElement(actual.DndContext, props)
    },
  }
})
vi.mock("../actions", () => ({ moveTaskAction, markDoneAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  dnd.current = null
})

function card(
  n: number,
  overrides: Partial<BoardCard> & { title: string }
): BoardCard {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    ownerName: "Layout",
    dueAt: "2099-01-01T00:00:00+00:00",
    column: "to_do",
    overdue: false,
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
    moves: [],
    ...overrides,
  }
}

const SPREAD = card(1, {
  title: "Lay out the spread",
  column: "to_do",
  moves: ["doing"],
})
const PHOTOS = card(3, {
  title: "Edit the photos",
  column: "doing",
  moves: ["to_do", "for_review"],
})
// For Review cards: the approver's moves end with Done (can_review); an
// assignee's never hold it.
const REVIEWED = card(5, {
  title: "Check the proofs",
  column: "for_review",
  moves: ["done"],
})
const ASSIGNED = card(6, {
  title: "Caption the photos",
  column: "for_review",
  moves: ["to_do", "doing"],
})
const CARDS = [SPREAD, PHOTOS]

const STALE =
  "Something changed since you opened this. Review the latest and try again."

const column = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label}\\s*,`) })
const row = () => screen.getByRole("region", { name: "Board columns" })
const link = (title: string) => screen.getByRole("link", { name: title })

const pointer = () => new MouseEvent("mousedown")
const keyboard = () => new KeyboardEvent("keydown", { code: "Space" })

function handlers() {
  if (!dnd.current) throw new Error("DndContext was not rendered")
  return dnd.current
}

// A whole drag of `task`, ending over `overId` (null: over no column).
function drag(
  task: BoardCard,
  overId: string | null,
  activatorEvent: Event = pointer()
) {
  const active = { id: task.id }
  const over = overId ? { id: overId } : null
  act(() => handlers().onDragStart({ active, activatorEvent }))
  act(() => handlers().onDragOver({ active, over, activatorEvent }))
  act(() => handlers().onDragEnd({ active, over, activatorEvent }))
}

// A click on `element`, reporting whether it reached the element (the guard
// stops it at the window first) and whether its default action was
// prevented. The listener stops it there, so Next's Link never navigates.
function click(element: HTMLElement) {
  const reached = vi.fn((event: Event) => event.stopPropagation())
  element.addEventListener("click", reached)
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  element.removeEventListener("click", reached)
  return {
    reached: reached.mock.calls.length > 0,
    prevented: event.defaultPrevented,
  }
}

describe("TaskBoard drag", () => {
  it("moves a card dropped on a column it may move to, at once", async () => {
    moveTaskAction.mockResolvedValue({ ok: true, data: { column: "doing" } })
    render(<TaskBoard cards={CARDS} />)

    drag(SPREAD, "doing")

    expect(moveTaskAction).toHaveBeenCalledExactlyOnceWith({
      taskId: SPREAD.id,
      toColumn: "doing",
    })
    expect(markDoneAction).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        within(column("Doing")).getByRole("heading", {
          level: 3,
          name: "Lay out the spread",
        })
      ).toBeInTheDocument()
    )
    // Only a Done move toasts.
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it.each([
    ["a column it may not move to", "done"],
    ["its own column", "to_do"],
    ["no column", null],
    ["something that isn't a column", "not-a-column"],
  ])("does nothing for a drop on %s", (_label, overId) => {
    render(<TaskBoard cards={CARDS} />)

    drag(SPREAD, overId)

    expect(moveTaskAction).not.toHaveBeenCalled()
    expect(
      within(column("To Do")).getByText("Lay out the spread")
    ).toBeInTheDocument()
  })

  it("moves a card dropped on Done through markDoneAction, never moveTaskAction, and toasts once saved", async () => {
    markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
    render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

    drag(REVIEWED, "done")

    expect(markDoneAction).toHaveBeenCalledExactlyOnceWith({
      taskId: REVIEWED.id,
    })
    expect(moveTaskAction).not.toHaveBeenCalled()
    // At once, before the save resolves.
    expect(
      within(column("Done")).getByRole("heading", {
        level: 3,
        name: "Check the proofs",
      })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith("Marked done.")
    )
  })

  it("rings Done only while a card whose moves hold it is held over it", () => {
    render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)
    const over = (task: BoardCard) => {
      const active = { id: task.id }
      act(() => handlers().onDragStart({ active, activatorEvent: pointer() }))
      act(() =>
        handlers().onDragOver({
          active,
          over: { id: "done" },
          activatorEvent: pointer(),
        })
      )
      const ringed = column("Done").classList.contains("ring-2")
      act(() =>
        handlers().onDragCancel({
          active,
          over: null,
          activatorEvent: pointer(),
        })
      )
      return ringed
    }

    expect(over(REVIEWED)).toBe(true)
    expect(over(ASSIGNED)).toBe(false)
  })

  it("does nothing when a card whose moves lack Done is dropped there", () => {
    render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

    drag(ASSIGNED, "done")

    expect(markDoneAction).not.toHaveBeenCalled()
    expect(moveTaskAction).not.toHaveBeenCalled()
    expect(
      within(column("For Review")).getByText("Caption the photos")
    ).toBeInTheDocument()
  })

  it.each([
    ["tasks.not_approver", "Only the task's head or a top editor can do that."],
    ["tasks.stale", STALE],
  ])(
    "puts a card dropped on Done back when refused with %s, toasts and refreshes",
    async (code, copy) => {
      markDoneAction.mockResolvedValue({ ok: false, code })
      render(<TaskBoard cards={[REVIEWED, ASSIGNED]} />)

      drag(REVIEWED, "done")

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy))
      expect(refresh).toHaveBeenCalledOnce()
      await waitFor(() =>
        expect(
          within(column("For Review")).getByText("Check the proofs")
        ).toBeInTheDocument()
      )
      expect(within(column("Done")).queryByText("Check the proofs")).toBeNull()
      expect(toastSuccess).not.toHaveBeenCalled()
    }
  )

  it("does nothing on a cancelled drag", () => {
    render(<TaskBoard cards={CARDS} />)
    const active = { id: SPREAD.id }

    act(() => handlers().onDragStart({ active, activatorEvent: pointer() }))
    act(() =>
      handlers().onDragCancel({
        active,
        over: { id: "doing" },
        activatorEvent: pointer(),
      })
    )

    expect(moveTaskAction).not.toHaveBeenCalled()
  })

  it("ignores a drop while another move saves", async () => {
    const user = userEvent.setup()
    moveTaskAction.mockReturnValue(new Promise(() => {}))
    render(<TaskBoard cards={CARDS} />)

    await user.click(
      screen.getByRole("combobox", { name: "Move to…, Lay out the spread" })
    )
    await user.click(await screen.findByRole("option", { name: "Doing" }))
    drag(PHOTOS, "for_review")

    expect(moveTaskAction).toHaveBeenCalledTimes(1)
  })

  it("rings the column a held card would drop into, and stops snapping while dragging", () => {
    render(<TaskBoard cards={CARDS} />)
    const active = { id: SPREAD.id }

    act(() => handlers().onDragStart({ active, activatorEvent: pointer() }))
    act(() =>
      handlers().onDragOver({
        active,
        over: { id: "doing" },
        activatorEvent: pointer(),
      })
    )

    expect(row()).toHaveClass("snap-none")
    expect(column("Doing")).toHaveClass("ring-2")
    expect(column("To Do")).not.toHaveClass("ring-2")

    act(() =>
      handlers().onDragCancel({ active, over: null, activatorEvent: pointer() })
    )
    expect(row()).toHaveClass("snap-x")
    expect(column("Doing")).not.toHaveClass("ring-2")
  })

  it("puts focus back on the moved card's title link after a drag", async () => {
    moveTaskAction.mockResolvedValue({ ok: true, data: { column: "doing" } })
    render(<TaskBoard cards={CARDS} />)
    ;(document.activeElement as HTMLElement | null)?.blur()

    drag(SPREAD, "doing", keyboard())

    await waitFor(() => expect(link("Lay out the spread")).toHaveFocus())
  })

  it("does not start a drag from a mouse or touch start on the card menu", () => {
    render(<TaskBoard cards={CARDS} />)
    const trigger = screen.getByRole("button", {
      name: "More actions, Lay out the spread",
    })

    fireEvent.mouseDown(trigger, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 })
    fireEvent.touchStart(trigger, {
      touches: [{ clientX: 0, clientY: 0 }],
    })

    expect(row()).not.toHaveClass("snap-none")
    expect(document.querySelector("[inert]")).toBeNull()
    expect(link("Lay out the spread")).toBeInTheDocument()
  })

  it("swallows the click that ends a pointer drag, once", async () => {
    render(<TaskBoard cards={CARDS} />)

    drag(SPREAD, null)

    // Released over its own title link: no navigation, and React never sees it.
    expect(click(link("Lay out the spread"))).toEqual({
      reached: false,
      prevented: true,
    })
    // The guard is one-shot.
    expect(click(link("Lay out the spread"))).toEqual({
      reached: true,
      prevented: false,
    })
  })

  it("drops the click guard shortly after a drag with no click", async () => {
    render(<TaskBoard cards={CARDS} />)

    drag(SPREAD, null)
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(click(link("Lay out the spread"))).toEqual({
      reached: true,
      prevented: false,
    })
  })

  it("leaves clicks alone after a keyboard drag", () => {
    render(<TaskBoard cards={CARDS} />)

    drag(SPREAD, null, keyboard())

    expect(click(link("Lay out the spread"))).toEqual({
      reached: true,
      prevented: false,
    })
  })

  it("control: a mouse drag on the card itself does start one", () => {
    render(<TaskBoard cards={CARDS} />)
    const title = link("Lay out the spread")

    fireEvent.mouseDown(title, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 })

    expect(row()).toHaveClass("snap-none")
    fireEvent.keyDown(document, { code: "Escape" })
  })
})
