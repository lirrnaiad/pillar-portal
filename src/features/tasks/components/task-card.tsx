import type { Ref } from "react"
import Link from "next/link"

import { StatusBadge, StatusDot } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { formatInPht } from "@/lib/time"

import type { TaskCardData } from "../queries"
import {
  SLOT_STATE_FAMILIES,
  SLOT_STATE_LABELS,
  TASK_COLUMN_FAMILIES,
  TASK_COLUMN_LABELS,
} from "../status"

const DUE_FORMAT = "EEE, MMM d, h:mm a"
const MAX_AVATARS = 3

/**
 * Extra props for the title link, so the Board can make it the keyboard drag
 * activator (its ref, dnd-kit's `aria-describedby`, `draggable={false}`).
 * Without them nothing changes.
 */
export type TitleLinkProps = {
  ref?: Ref<HTMLAnchorElement>
  "aria-describedby"?: string
  draggable?: boolean
}

/**
 * A task card (UX-DR20, without the overflow menu). The title is the only
 * link and its box is stretched over the card's upper block, so tapping
 * anywhere there opens Task detail; `children` sit below that block, outside
 * the link's reach, so their buttons don't navigate. Status badges reflect
 * the slots' states and the due date: display only, they decide no action.
 * Keyboard focus shows as the card's ring. The link has `outline-hidden`, not
 * `outline-none`: forced-colors mode drops the ring (a box-shadow) but paints
 * that transparent outline. No directive and no members imports, so the Board
 * can reuse it.
 */
export function TaskCard({
  task,
  children,
  titleLinkProps,
}: {
  task: TaskCardData
  children?: React.ReactNode
  titleLinkProps?: TitleLinkProps
}) {
  const shown = task.assignees.slice(0, MAX_AVATARS)
  const extra = task.assignees.length - shown.length

  return (
    <article className="rounded-lg bg-card p-card-padding shadow-card has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="relative flex flex-col gap-2">
        <h3 className="font-semibold break-words">
          <Link
            href={`/dashboard/tasks/${task.id}`}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-hidden"
            {...titleLinkProps}
          >
            {task.title}
          </Link>
        </h3>

        {(task.hasAwaitingResponse ||
          task.hasNeedsReassignment ||
          task.overdue) && (
          <div className="flex flex-wrap gap-2">
            {task.hasAwaitingResponse && (
              <StatusBadge
                family={SLOT_STATE_FAMILIES.awaiting_response}
                label={SLOT_STATE_LABELS.awaiting_response}
              />
            )}
            {task.hasNeedsReassignment && (
              <StatusBadge
                family={SLOT_STATE_FAMILIES.needs_reassignment}
                label={SLOT_STATE_LABELS.needs_reassignment}
              />
            )}
            {task.overdue && <StatusBadge family="attention" label="Overdue" />}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {task.ownerName} · Due{" "}
          <time dateTime={task.dueAt}>
            {formatInPht(task.dueAt, DUE_FORMAT)}
          </time>
        </p>

        <div className="flex items-center justify-between gap-3">
          <StatusDot
            family={TASK_COLUMN_FAMILIES[task.column]}
            label={TASK_COLUMN_LABELS[task.column]}
            className="text-sm"
          />
          {task.assignees.length > 0 && (
            <>
              <span className="sr-only">
                Assigned to {task.assignees.map((a) => a.name).join(", ")}
              </span>
              <div aria-hidden="true" className="flex items-center">
                {shown.map((assignee) => (
                  <Avatar
                    key={assignee.id}
                    className="-ml-1.5 size-[22px] ring-2 ring-card first:ml-0"
                  >
                    <AvatarFallback className="bg-navy text-[10px] font-semibold text-white">
                      {assignee.initials}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {extra > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    +{extra}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {children}
    </article>
  )
}
