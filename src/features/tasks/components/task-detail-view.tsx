import { StatusBadge } from "@/components/status-badge"
import { ExternalLink } from "@/components/ui/external-link"
import { clientEnv } from "@/lib/env.client"
import { formatInPht } from "@/lib/time"

import { buildCalendarEvent, googleCalendarUrl } from "../calendar"
import { buildMessengerMessage } from "../messenger"
import type { TaskDetail } from "../queries/task-detail"
import { SLOT_STATE_FAMILIES, SLOT_STATE_LABELS } from "../status"
import { AddToCalendarMenu } from "./calendar-menu"
import { CopyForMessenger } from "./copy-for-messenger"
import { HandBack } from "./hand-back"
import { SlotResponse } from "./slot-response"
import { TaskColumnControl } from "./task-column-control"
import { TaskReview } from "./task-review"
import { TASK_STATUS_ID } from "./task-status-id"

const DUE_FORMAT = "EEE, MMM d, yyyy 'at' h:mm a"
const NOTE_DATE_FORMAT = "EEE, MMM d, yyyy"

/**
 * Task detail (EXPERIENCE.md › Task detail): title, column (with the revision
 * note under it while the task stands sent back), owner, due date in PHT,
 * reference link, description, then one row per slot. Which actions appear
 * comes only from `task.allowedMoves`, `task.respondableSlotIds`,
 * `task.handBackSlotIds`, `task.canReview` and `task.canReopen`
 * (task_capabilities, AD-4); nothing here looks at roles, positions or who
 * holds a slot.
 */
export function TaskDetailView({ task }: { task: TaskDetail }) {
  const respondable = new Set(task.respondableSlotIds)
  const handBackable = new Set(task.handBackSlotIds)
  const handBackSlots = task.slots.filter((slot) => handBackable.has(slot.id))
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

  const message = buildMessengerMessage(
    {
      id: task.id,
      title: task.title,
      roles: task.slots.map((slot) => slot.role),
      dueAt: task.dueAt,
    },
    clientEnv.NEXT_PUBLIC_SITE_URL,
    task.roleLabels
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
          sentBack={task.revisionNote !== null}
          allowedMoves={task.allowedMoves}
        />
      </div>

      {task.revisionNote !== null && (
        <div className="mt-3 rounded-r-lg border-l-[3px] border-status-attention bg-status-attention-tint px-card-padding py-3">
          <p className="break-words whitespace-pre-line">
            {task.revisionNote.text}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="sr-only">Sent back by </span>
            {task.revisionNote.byName} ·{" "}
            <time dateTime={task.revisionNote.at}>
              {formatInPht(task.revisionNote.at, NOTE_DATE_FORMAT)}
            </time>
          </p>
        </div>
      )}

      <TaskReview
        taskId={task.id}
        canReview={task.canReview}
        canReopen={task.canReopen}
        focusTargetId={TASK_STATUS_ID}
      />

      {handBackSlots.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {handBackSlots.map((slot) => (
            <HandBack
              key={slot.id}
              slotId={slot.id}
              slotLabel={task.roleLabels[slot.role]}
              rowId={`slot-${slot.id}`}
            />
          ))}
          <p className="text-sm text-muted-foreground">
            Can&apos;t take this? Hand it back — your head will reassign it.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <AddToCalendarMenu taskId={task.id} googleUrl={googleUrl} />
        <CopyForMessenger message={message} />
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
