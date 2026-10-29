import type { Metadata } from "next"

import {
  getReviewQueue,
  getTaskFormOptions,
  ReviewQueue,
  TaskForm,
} from "@/features/tasks"

import { requireAdmin } from "../../require-admin"

export const metadata: Metadata = {
  title: "Tasks · The Pillar Portal",
}

const HEADING_ID = "admin-tasks-heading"

// Tasks (spec-1-5-admin-task-creation.md, spec-3-6): the viewer's review
// queue, then the task form any admin creates a task with. The admin check
// comes first, as in the layout, which doesn't stop this page rendering;
// the commands themselves are the actual authority (AD-4). The queue and the
// form options are read together, with no Suspense boundary, so the queue
// never streams in above a form someone is already filling in, and no
// Realtime, so a refresh can't pull a row and its open dialog away mid-note.
// The h1 is the focus target when a reviewed row leaves the page.
export default async function AdminTasksPage() {
  await requireAdmin()
  const [reviewQueue, options] = await Promise.all([
    getReviewQueue(),
    getTaskFormOptions(),
  ])

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        Tasks
      </h1>
      <ReviewQueue tasks={reviewQueue} focusTargetId={HEADING_ID} />
      <h2 className="mt-8 text-heading-sm text-navy">Create a task</h2>
      <div className="mt-3 max-w-2xl">
        <TaskForm options={options} />
      </div>
    </>
  )
}
