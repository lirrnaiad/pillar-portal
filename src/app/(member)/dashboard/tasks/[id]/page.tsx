import type { Metadata } from "next"
import Link from "next/link"

import { getTaskDetail, TaskDetailView } from "@/features/tasks"

export const metadata: Metadata = {
  title: "Task · The Pillar Portal",
}

// Task detail, where a Messenger link lands (spec-1-6). A malformed id, a
// missing task and one the caller can't read all look the same: getTaskDetail
// returns null for each, and RLS and the commands decide everything else.
export default async function TaskPage({
  params,
}: PageProps<"/dashboard/tasks/[id]">) {
  const { id } = await params
  const task = await getTaskDetail(id)

  if (!task) {
    return (
      <>
        <h1 className="font-heading text-heading text-navy">
          This task was deleted or the link is wrong.
        </h1>
        <p className="mt-4">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center text-navy underline underline-offset-4 hover:no-underline"
          >
            Back to What&apos;s mine
          </Link>
        </p>
      </>
    )
  }

  return <TaskDetailView task={task} />
}
