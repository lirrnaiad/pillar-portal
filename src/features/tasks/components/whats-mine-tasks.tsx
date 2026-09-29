import type { WhatsMine } from "../queries"
import { SlotResponse } from "./slot-response"
import { TaskCard } from "./task-card"

/**
 * What's mine's lists (EXPERIENCE.md › What's mine): "Waiting for you", one
 * card per open awaiting slot, then "My tasks", the other tasks where the
 * viewer holds an open slot. A Waiting item offers I'm on it / Can't take
 * this only when the slot is respondable (task_capabilities, AD-4), and its
 * buttons are named for the role and the task, since one list can hold the
 * same role on several tasks. Those items leave the page after an answer, so
 * focus moves to `focusTargetId` (the page's h1) instead of the item.
 */
export function WhatsMineTasks({
  whatsMine,
  focusTargetId,
}: {
  whatsMine: WhatsMine
  focusTargetId: string
}) {
  const { waiting, tasks } = whatsMine

  return (
    <div className="mt-6 flex flex-col gap-8">
      {waiting.length > 0 && (
        <section aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className="text-heading-sm text-navy">
            Waiting for you ({waiting.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {waiting.map((item) => (
              <li key={item.slotId}>
                <TaskCard task={item.task}>
                  <p className="mt-3 text-sm font-medium">
                    Your slot: {item.roleLabel}
                  </p>
                  {item.respondable && (
                    <SlotResponse
                      slotId={item.slotId}
                      slotLabel={`${item.roleLabel}, ${item.task.title}`}
                      rowId={focusTargetId}
                    />
                  )}
                </TaskCard>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tasks.length > 0 && (
        <section aria-labelledby="my-tasks-heading">
          <h2 id="my-tasks-heading" className="text-heading-sm text-navy">
            My tasks ({tasks.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskCard task={task} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
