import Link from "next/link"

import { formatInPht } from "@/lib/time"

import type { HandedBackSlot } from "../queries/handed-back"
import type { ReassignOptions } from "../queries/reassign"
import { SLOT_STATE_LABELS } from "../status"
import { ReassignSlot } from "./reassign-slot"

// TaskCard's due-date format.
const DUE_FORMAT = "EEE, MMM d, h:mm a"

/**
 * `/admin/tasks`' "Needs reassignment (n)": the handed-back slots
 * `getHandedBackQueue()` returns (task_capabilities' can_reassign, AD-4),
 * soonest due first, n counting slots. Each row is a card with the task's
 * title (linked to Task detail, its box stretched over the card's upper
 * block as on TaskCard), the role and who handed it back, their reason when
 * given, the due date in PHT, and 3.3's **Reassign**, named for its role and
 * task. Nothing at all when the queue is empty; `options` (the picker's
 * members) is read only when it isn't. A reassigned row leaves the page, so
 * focus moves to `focusTargetId` (the page's h1) instead of the row.
 */
export function HandedBackQueue({
  slots,
  options,
  focusTargetId,
}: {
  slots: HandedBackSlot[]
  options: ReassignOptions | null
  focusTargetId: string
}) {
  if (slots.length === 0 || options === null) return null

  return (
    <section
      aria-labelledby="handed-back-queue-heading"
      className="mt-6 max-w-2xl"
    >
      <h2 id="handed-back-queue-heading" className="text-heading-sm text-navy">
        Needs reassignment ({slots.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {slots.map((slot) => (
          <li key={slot.slotId}>
            <article className="rounded-lg bg-card p-card-padding shadow-card has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
              <div className="relative flex flex-col gap-1">
                <h3 className="font-semibold break-words">
                  <Link
                    href={`/dashboard/tasks/${slot.taskId}`}
                    className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-hidden"
                  >
                    {slot.taskTitle}
                  </Link>
                </h3>
                <p className="text-sm break-words">
                  {`${slot.roleLabel} · ${slot.memberName}`}
                </p>
                {slot.reason !== null && (
                  <p className="text-sm break-words text-muted-foreground">
                    Reason: {slot.reason}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Due{" "}
                  <time dateTime={slot.dueAt}>
                    {formatInPht(slot.dueAt, DUE_FORMAT)}
                  </time>
                </p>
              </div>
              <div className="mt-3">
                <ReassignSlot
                  taskId={slot.taskId}
                  taskTitle={slot.taskTitle}
                  taskDueAt={slot.dueAt}
                  slotId={slot.slotId}
                  role={slot.role}
                  memberId={slot.memberId}
                  memberName={slot.memberName}
                  stateLabel={SLOT_STATE_LABELS.needs_reassignment}
                  expectedUpdatedAt={slot.slotUpdatedAt}
                  options={options}
                  focusTargetId={focusTargetId}
                  namedForTask
                />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
