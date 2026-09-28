import type { Metadata } from "next"

import { getTaskFormOptions, TaskForm } from "@/features/tasks"

export const metadata: Metadata = {
  title: "Create a task · The Pillar Portal",
}

// Any admin creates a task here (spec-1-5-admin-task-creation.md). The
// (admin) layout has already refused a signed-out, pending or staff caller;
// create_task itself is the actual authority (AD-4).
export default async function AdminTasksPage() {
  const options = await getTaskFormOptions()

  return (
    <>
      <h1 className="font-heading text-display text-navy">Create a task</h1>
      <div className="mt-6 max-w-2xl">
        <TaskForm options={options} />
      </div>
    </>
  )
}
