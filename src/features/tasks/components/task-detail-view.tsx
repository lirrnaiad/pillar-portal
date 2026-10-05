import { StatusBadge } from "@/components/status-badge"
import { ExternalLink } from "@/components/ui/external-link"
import { clientEnv } from "@/lib/env.client"
import { formatInPht } from "@/lib/time"

import { buildCalendarEvent, googleCalendarUrl } from "../calendar"
import type { TaskDetail } from "../queries"
import { SLOT_STATE_FAMILIES, SLOT_STATE_LABELS } from "../status"
import { AddToCalendarMenu } from "./calendar-menu"
import { SlotResponse } from "./slot-response"
import { TaskColumnControl } from "./task-column-control"

const DUE_FORMAT = "EEE, MMM d, yyyy 'at' h:mm a"

/**
 * Task detail (EXPERIENCE.md › Task detail): title, column, owner, due date
 * in PHT, reference link, description, then one row per slot. Which actions
 * appear comes only from `task.allowedMoves` and `task.respondableSlotIds`
 * (task_capabilities, AD-4); nothing here looks at roles, positions or who
 * holds a slot.
 */
export function TaskDetailView({ task }: { task: TaskDetail }) {
  const respondable = new Set(task.respondableSlotIds)
  const googleUrl = googleCalendarUrl(
    buildCalendarEvent(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt,
        referenceUrl: task.referenceUrl,
      },
      clientEnv.NEXT_PUBLIC_SITE_URL
    )
  )

  return (
    <article>
      <h1 className="font-heading text-display break-words text-navy">
        {task.title}
      </h1>

      <div className="mt-3">
        <TaskColumnControl
          taskId={task.id}
          column={task.column}
          allowedMoves={task.allowedMoves}
        />
      </div>

      <div className="mt-3">
        <AddToCalendarMenu taskId={task.id} googleUrl={googleUrl} />
      </div>

      <dl className="mt-6 flex flex-col gap-3">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="text-muted-foreground sm:w-32 sm:shrink-0">Owner</dt>
          <dd>{task.ownerName}</dd>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="text-muted-foreground sm:w-32 sm:shrink-0">Due</dt>
          <dd>
            <time dateTime={task.dueAt}>
              {formatInPht(task.dueAt, DUE_FORMAT)}
            </time>
          </dd>
        </div>
        {task.referenceUrl !== null && (
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-32 sm:shrink-0">
              Reference link
            </dt>
            <dd className="min-w-0 break-all">
              <ExternalLink
                href={task.referenceUrl}
                className="inline-flex min-h-11 items-center"
              >
                {task.referenceUrl}
              </ExternalLink>
            </dd>
          </div>
        )}
      </dl>

      {task.description !== null && task.description !== "" && (
        <p className="mt-6 break-words whitespace-pre-line">
          {task.description}
        </p>
      )}

      <h2 className="mt-8 text-heading-sm text-navy">Slots</h2>
      <ul className="mt-3 flex flex-col divide-y divide-border rounded-lg bg-card px-card-padding shadow-card">
        {task.slots.map((slot) => {
          const roleLabel = task.roleLabels[slot.role]
          // Focus lands here once an answer is saved and SlotResponse goes
          // away, so it stays on this slot instead of falling to the page.
          const rowId = `slot-${slot.id}`
          return (
            <li
              key={slot.id}
              id={rowId}
              tabIndex={-1}
              className="rounded-sm py-3 outline-offset-2 focus-visible:outline-2"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{roleLabel}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span>{slot.memberName}</span>
                <StatusBadge
                  family={SLOT_STATE_FAMILIES[slot.state]}
                  label={SLOT_STATE_LABELS[slot.state]}
                />
              </div>
              {slot.reason !== null && (
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  Reason: {slot.reason}
                </p>
              )}
              {respondable.has(slot.id) && (
                <SlotResponse
                  slotId={slot.id}
                  slotLabel={roleLabel}
                  rowId={rowId}
                />
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}
