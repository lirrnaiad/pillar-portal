import type { Metadata } from "next"
import { redirect } from "next/navigation"

import {
  getTaskEdit,
  getTaskFormOptions,
  TaskForm,
  taskEditKey,
  TaskNotFound,
} from "@/features/tasks"

import { requireAdmin } from "../../../../require-admin"

export const metadata: Metadata = {
  title: "Edit task · The Pillar Portal",
}

// Edit task (spec-3-7): the task form in edit mode. The admin check comes
// first, as on every admin page; the task and the form options are then read
// together, with no Suspense boundary. A malformed id, a missing or deleted
// task and one the caller can't read show Task detail's not-found. An admin
// who isn't the task's approver (task_capabilities' can_manage) goes to Task
// detail instead; update_task is the actual authority (AD-4). The form is
// keyed on the task's version and its slots, so a re-read after a stale save
// remounts it on the latest values.
export default async function EditTaskPage({
  params,
}: PageProps<"/admin/tasks/[id]/edit">) {
  await requireAdmin()
  const { id } = await params
  const [task, options] = await Promise.all([
    getTaskEdit(id),
    getTaskFormOptions(),
  ])

  if (!task) return <TaskNotFound />

  if (!task.canManage) redirect(`/dashboard/tasks/${task.id}`)

  return (
    <>
      <h1 className="font-heading text-display text-navy">Edit task</h1>
      <div className="mt-3 max-w-2xl">
        <TaskForm key={taskEditKey(task)} options={options} task={task} />
      </div>
    </>
  )
}
