import type { TaskEdit, TaskEditSlot } from "./queries/task-edit"

/**
 * The edit page's key for the task form: the task's version (`updated_at`)
 * and each slot's id and member. A re-read that brings a newer task, or a
 * slot with another member, changes it, so the form remounts on the latest
 * values (UX-DR56) instead of keeping what was typed over them.
 */
export function taskEditKey(task: {
  updatedAt: TaskEdit["updatedAt"]
  slots: Pick<TaskEditSlot, "id" | "memberId">[]
}): string {
  return [
    task.updatedAt,
    ...task.slots.map((slot) => `${slot.id}:${slot.memberId}`),
  ].join("|")
}
