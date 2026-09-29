"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { StatusDot } from "@/components/status-badge"
import { cn } from "@/lib/utils"

import { moveTaskAction, type MoveTaskState } from "../actions"
import { BOARD_ROW_HEIGHT } from "../board"
import {
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  boardCollisionDetection,
  columnJumpCoordinates,
  createBoardAnnouncements,
  dropColumn,
} from "../board-dnd"
import { taskErrorMessage } from "../errors"
import type { BoardCard } from "../queries"
import {
  TASK_COLUMN_FAMILIES,
  TASK_COLUMN_LABELS,
  TASK_COLUMNS,
  type TaskColumn,
} from "../status"
import { MoveToSelect } from "./move-to-select"
import { refreshAfterFailure } from "./refresh-after-failure"
import { TaskCard } from "./task-card"

type HowMoved = "select" | "drag"

/**
 * The Board's four columns of task cards in one row (Trello-style). Below
 * `lg` each column is 288px and the row scrolls sideways, snapping column by
 * column; from `lg` the four share the width. Every column is full height and
 * its card list scrolls inside it.
 *
 * A card moves two ways, both through `moveTaskAction` and both offering only
 * the card's `allowedMoves` (AD-4): dragging the card (mouse after 8px, touch
 * after a 250ms hold, keyboard with Space on its title link) and its "Move
 * to…" select, the non-drag equivalent (WCAG 2.5.7). The card changes column
 * at once; a refused or thrown move puts it back, toasts the error's copy and
 * refreshes. One move saves at a time: meanwhile every control ignores input
 * and drag is off.
 *
 * Focus follows the moved card. Its old element unmounts and a new one mounts
 * in the target column (and again on a rollback), so a layout effect puts
 * focus back on its select after a select move or its title link after a drag
 * whenever focus has fallen to the page.
 *
 * dnd-kit stops the click that ends a mouse or touch drag from propagating,
 * but not its default action: released over the card's own title link, the
 * browser would still follow it with a full page load. So a pointer drag
 * swallows that one click.
 */
export function TaskBoard({ cards }: { cards: BoardCard[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [shownCards, applyMove] = useOptimistic(
    cards,
    (
      state: BoardCard[],
      move: { taskId: string; toColumn: TaskColumn }
    ): BoardCard[] =>
      state.map((card) =>
        card.id === move.taskId
          ? {
              ...card,
              column: move.toColumn,
              overdue: move.toColumn === "done" ? false : card.overdue,
            }
          : card
      )
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TaskColumn | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastMoved = useRef<{ taskId: string; how: HowMoved } | null>(null)
  const releaseClickGuard = useRef<(() => void) | null>(null)

  useEffect(() => () => releaseClickGuard.current?.(), [])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: BOARD_KEYBOARD_CODES,
      coordinateGetter: columnJumpCoordinates,
    })
  )

  const announcements = useMemo(
    () =>
      createBoardAnnouncements(
        (id) => shownCards.find((card) => card.id === id)?.title ?? "the task"
      ),
    [shownCards]
  )

  useLayoutEffect(() => {
    const moved = lastMoved.current
    if (!moved) return
    const focused = document.activeElement
    if (!focused || focused === document.body) {
      const item = rootRef.current?.querySelector<HTMLElement>(
        `[data-card-id="${moved.taskId}"]`
      )
      const select = item?.querySelector<HTMLElement>('[role="combobox"]')
      const link = item?.querySelector<HTMLElement>("a")
      const target = moved.how === "select" ? (select ?? link) : link
      target?.focus()
    }
    // Once a render with nothing saving has run the check, the move is over:
    // the remount into the new column and the rollback remount are both done.
    if (!isPending) lastMoved.current = null
  })

  function move(taskId: string, toColumn: TaskColumn, how: HowMoved) {
    if (isPending) return
    lastMoved.current = { taskId, how }
    startTransition(async () => {
      applyMove({ taskId, toColumn })
      let result: MoveTaskState
      try {
        result = await moveTaskAction({ taskId, toColumn })
      } catch {
        toast.error(taskErrorMessage("tasks.save_failed"))
        refreshAfterFailure(router)
        return
      }
      if (!result.ok) {
        toast.error(taskErrorMessage(result.code))
        refreshAfterFailure(router)
      }
    })
  }

  function guardClickAfterDrag() {
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("click", swallow, { capture: true, once: true })
    releaseClickGuard.current = () =>
      window.removeEventListener("click", swallow, { capture: true })
  }

  // The closing click comes right after the drop, so the guard stays up a
  // moment longer (dnd-kit waits 50ms for the same reason).
  function releaseClickGuardSoon() {
    const release = releaseClickGuard.current
    releaseClickGuard.current = null
    if (release) setTimeout(release, 100)
  }

  function handleDragStart(event: DragStartEvent) {
    if (!(event.activatorEvent instanceof KeyboardEvent)) guardClickAfterDrag()
    setActiveId(String(event.active.id))
    setOverColumn(null)
  }

  function handleDragOver(event: DragOverEvent) {
    const card = shownCards.find((c) => c.id === event.active.id)
    setOverColumn(card ? dropColumn(card.allowedMoves, event.over?.id) : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    releaseClickGuardSoon()
    const card = shownCards.find((c) => c.id === event.active.id)
    setActiveId(null)
    setOverColumn(null)
    if (!card) return
    const toColumn = dropColumn(card.allowedMoves, event.over?.id)
    if (toColumn) move(card.id, toColumn, "drag")
  }

  function handleDragCancel() {
    releaseClickGuardSoon()
    setActiveId(null)
    setOverColumn(null)
  }

  const activeCard = shownCards.find((card) => card.id === activeId)

  return (
    <DndContext
      id="task-board"
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: BOARD_SCREEN_READER_INSTRUCTIONS,
        },
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        ref={rootRef}
        role="region"
        aria-label="Board columns"
        tabIndex={0}
        className={cn(
          // relative: the row must be the containing block of the
          // absolutely positioned sr-only text inside it, or that text
          // escapes the row's clipping and widens the whole page.
          "relative flex gap-column-gap overflow-x-auto overscroll-x-contain rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset",
          BOARD_ROW_HEIGHT,
          // Below lg the row bleeds to the screen edge and snaps column by
          // column (not while dragging, so auto-scroll isn't snapped back).
          "-mx-page-margin-mobile scroll-px-page-margin-mobile px-page-margin-mobile md:-mx-page-margin-desktop md:scroll-px-page-margin-desktop md:px-page-margin-desktop",
          activeId ? "snap-none" : "snap-x snap-mandatory",
          "lg:mx-0 lg:snap-none lg:scroll-px-0 lg:px-0"
        )}
      >
        {TASK_COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            column={column}
            cards={shownCards.filter((card) => card.column === column)}
            activeCard={activeCard}
            isOver={overColumn === column}
            isPending={isPending}
            onMove={move}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={null}
        className={overColumn ? "cursor-grabbing" : "cursor-not-allowed"}
      >
        {activeCard ? (
          // inert hit-tests like pointer-events: none, so the cursor comes
          // from the overlay wrapper above.
          <div inert className="motion-safe:rotate-2">
            <TaskCard task={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({
  column,
  cards,
  activeCard,
  isOver,
  isPending,
  onMove,
}: {
  column: TaskColumn
  cards: BoardCard[]
  activeCard: BoardCard | undefined
  isOver: boolean
  isPending: boolean
  onMove: (taskId: string, toColumn: TaskColumn, how: HowMoved) => void
}) {
  // A column takes a drop only while a card that may move there is held.
  const accepts = !!activeCard && activeCard.allowedMoves.includes(column)
  const { setNodeRef } = useDroppable({ id: column, disabled: !accepts })
  const headingId = `board-column-${column}`

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex h-full w-72 shrink-0 snap-start flex-col rounded-xl bg-muted lg:w-auto lg:min-w-0 lg:flex-1",
        isOver && accepts && "ring-2 ring-ring ring-inset"
      )}
    >
      <h2 id={headingId} className="px-3 pt-3 pb-2 text-sm font-semibold">
        <span className="inline-flex items-center gap-2">
          <StatusDot
            family={TASK_COLUMN_FAMILIES[column]}
            label={TASK_COLUMN_LABELS[column]}
          />
          <span
            aria-hidden="true"
            className="font-normal text-muted-foreground"
          >
            {cards.length}
          </span>
          <span className="sr-only">
            , {cards.length} {cards.length === 1 ? "task" : "tasks"}
          </span>
        </span>
      </h2>
      {cards.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground/70">
          Nothing here
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
          {cards.map((card) => (
            <BoardCardItem
              key={card.id}
              card={card}
              isPending={isPending}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function BoardCardItem({
  card,
  isPending,
  onMove,
}: {
  card: BoardCard
  isPending: boolean
  onMove: (taskId: string, toColumn: TaskColumn, how: HowMoved) => void
}) {
  const movable = card.allowedMoves.length > 0
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: card.id, disabled: isPending || !movable })

  // Only the title link joins the drag wiring, and only on a movable card:
  // role="button"/tabIndex on the <li> would wrap a link and a select in a
  // focusable button (axe's nested-interactive).
  const titleLinkProps = movable
    ? {
        ref: setActivatorNodeRef,
        "aria-describedby": attributes["aria-describedby"],
        draggable: false,
      }
    : undefined

  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <li
      ref={setNodeRef}
      data-card-id={card.id}
      {...listeners}
      className={cn(
        "touch-manipulation select-none [-webkit-touch-callout:none]",
        isDragging && "opacity-50"
      )}
    >
      <TaskCard task={card} titleLinkProps={titleLinkProps}>
        {movable && (
          // The select must never start a drag.
          <div className="mt-3" onMouseDown={stop} onTouchStart={stop}>
            <MoveToSelect
              allowedMoves={card.allowedMoves}
              pending={isPending}
              onMove={(toColumn) => onMove(card.id, toColumn, "select")}
              label={`Move to…, ${card.title}`}
            />
          </div>
        )}
      </TaskCard>
    </li>
  )
}
