import type { Metadata } from "next"

import {
  getHandedBackQueue,
  getReassignOptions,
  getReviewQueue,
  getTaskFormOptions,
  HandedBackQueue,
  ReviewQueue,
  TaskForm,
} from "@/features/tasks"

import { requireAdmin } from "../../require-admin"

export const metadata: Metadata = {
  title: "Tasks · The Pillar Portal",
}

const HEADING_ID = "admin-tasks-heading"

// Tasks (spec-1-5-admin-task-creation.md, spec-3-6, spec-3-8): the viewer's
// Needs reassignment queue, then their review queue, then the task form any
// admin creates a task with. The admin check comes first, as in the layout,
// which doesn't stop this page rendering; the commands themselves are the
// actual authority (AD-4). Both queues and the form options are read
// together, with no Suspense boundary, so a queue never streams in above a
// form someone is already filling in, and no Realtime, so a refresh can't
// pull a row and its open dialog away mid-note. The reassign picker's
// members are built only when there is a slot to reassign, from the form
// options already read, adding just the load counts. The h1 is the focus
// target when a reviewed or reassigned row leaves the page.
export default async function AdminTasksPage() {
  await requireAdmin()
  const [handedBack, reviewQueue, options] = await Promise.all([
    getHandedBackQueue(),
    getReviewQueue(),
    getTaskFormOptions(),
  ])
  const reassignOptions =
    handedBack.length > 0 ? await getReassignOptions(options) : null

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        Tasks
      </h1>
      <HandedBackQueue
        slots={handedBack}
        options={reassignOptions}
        focusTargetId={HEADING_ID}
      />
      <ReviewQueue tasks={reviewQueue} focusTargetId={HEADING_ID} />
      <h2 className="mt-8 text-heading-sm text-navy">Create a task</h2>
      <div className="mt-3 max-w-2xl">
        <TaskForm options={options} />
      </div>
    </>
  )
}
