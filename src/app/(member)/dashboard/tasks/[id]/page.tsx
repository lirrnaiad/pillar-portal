import type { Metadata } from "next"

import { requireActiveMember } from "@/features/members"
import { getTaskDetail, TaskDetailView, TaskNotFound } from "@/features/tasks"

export const metadata: Metadata = {
  title: "Task · The Pillar Portal",
}

// Task detail, where a Messenger link lands (spec-1-6). The state check comes
// first. A malformed id, a missing task and one the caller can't read all
// look the same: getTaskDetail returns null for each, and RLS and the
// commands decide everything else.
export default async function TaskPage({
  params,
}: PageProps<"/dashboard/tasks/[id]">) {
  await requireActiveMember()
  const { id } = await params
  const task = await getTaskDetail(id)

  if (!task) return <TaskNotFound />

  return <TaskDetailView task={task} />
}
