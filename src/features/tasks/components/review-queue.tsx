import type { TaskCardData } from "../queries/shared"
import { TaskCard } from "./task-card"
import { TaskReview } from "./task-review"

/**
 * `/admin/tasks`' "Waiting for your review (n)": the tasks
 * `getReviewQueue()` returns (task_capabilities' can_review, AD-4), soonest
 * due first, each with **Mark done** and **Send back with note** named for
 * its task. Nothing at all when the queue is empty. A reviewed row leaves the
 * page, so focus moves to `focusTargetId` (the page's h1) instead of the row.
 */
export function ReviewQueue({
  tasks,
  focusTargetId,
}: {
  tasks: TaskCardData[]
  focusTargetId: string
}) {
  if (tasks.length === 0) return null

  return (
    <section aria-labelledby="review-queue-heading" className="mt-6 max-w-2xl">
      <h2 id="review-queue-heading" className="text-heading-sm text-navy">
        Waiting for your review ({tasks.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskCard task={task}>
              <TaskReview
                taskId={task.id}
                canReview
                canReopen={false}
                taskTitle={task.title}
                focusTargetId={focusTargetId}
              />
            </TaskCard>
          </li>
        ))}
      </ul>
    </section>
  )
}
