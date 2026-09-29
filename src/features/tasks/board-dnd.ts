// The Board's drag-and-drop rules, kept pure so they can be tested with fake
// rects. Which columns a card may go to is never decided here: every function
// takes the card's `allowedMoves` (task_capabilities' answer, AD-4) as given.

import {
  pointerWithin,
  rectIntersection,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core"

import { TASK_COLUMN_LABELS, TASK_COLUMNS, type TaskColumn } from "./status"

/**
 * Space starts and drops; Enter (either one) drops but doesn't start, so Enter
 * on a card's title link still opens the task. The keypad's Enter is listed
 * too: a key the sensor doesn't handle isn't prevented, and on the focused link
 * it would open the task mid-drag. Tab cancels (dnd-kit's default would drop
 * on Tab, moving a card by accident).
 */
export const BOARD_KEYBOARD_CODES: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape", "Tab"],
  end: ["Space", "Enter", "NumpadEnter"],
}

export const BOARD_SCREEN_READER_INSTRUCTIONS =
  "To pick up a card, press space. Use the left and right arrow keys to choose a column, then press space or enter to drop it, or escape to cancel. The Move to menu does the same."

function isTaskColumn(value: unknown): value is TaskColumn {
  return (TASK_COLUMNS as readonly unknown[]).includes(value)
}

/**
 * The column a drop lands in, or null when the target is missing, isn't a
 * column, or isn't one of the card's `allowedMoves` (which excludes its own
 * column).
 */
export function dropColumn(
  allowedMoves: readonly TaskColumn[],
  overId: unknown
): TaskColumn | null {
  if (!isTaskColumn(overId)) return null
  return allowedMoves.includes(overId) ? overId : null
}

/**
 * ←/→ jump to the nearest enabled column on that side (only the columns the
 * card may move to are enabled droppables) and return the collision rect's
 * new top-left, centred horizontally in that column. The sensor scrolls the
 * row when that column is off-screen. Other keys, or no column that way,
 * return undefined.
 */
export const columnJumpCoordinates: KeyboardCoordinateGetter = (
  event,
  { context }
) => {
  const rect = context.collisionRect
  if (!rect) return undefined
  const direction =
    event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0
  if (direction === 0) return undefined

  const centre = rect.left + rect.width / 2
  let nearest: ClientRect | undefined
  let nearestDistance = Infinity
  for (const column of context.droppableRects.values()) {
    const distance = (column.left + column.width / 2 - centre) * direction
    // A column whose centre is the card's own is where it already is.
    if (distance > 0.5 && distance < nearestDistance) {
      nearest = column
      nearestDistance = distance
    }
  }
  if (!nearest) return undefined

  return {
    x: nearest.left + (nearest.width - rect.width) / 2,
    y: nearest.top,
  }
}

/** Mouse and touch follow the pointer; the keyboard follows the card's rect. */
export const boardCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)

/**
 * Screen-reader announcements naming the task and the column. `titleOf` maps
 * a draggable id to its task's title.
 */
export function createBoardAnnouncements(
  titleOf: (id: unknown) => string
): Announcements {
  const columnLabel = (id: unknown) =>
    isTaskColumn(id) ? TASK_COLUMN_LABELS[id] : "a column"

  return {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} is over ${columnLabel(over.id)}.`
        : `${titleOf(active.id)} is not over a column it can move to.`,
    // The move is only being saved at this point; a refusal puts the card
    // back and says so in a toast.
    onDragEnd: ({ active, over }) =>
      over
        ? `Moving ${titleOf(active.id)} to ${columnLabel(over.id)}.`
        : `${titleOf(active.id)} was not moved.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  }
}
