// Error codes createTaskAction returns, and the copy each one shows. Raw
// Postgres errors never reach the UI (mirrors src/features/members/errors.ts).
//
// tasks.no_slots and tasks.invalid_slot_member are raised by create_task but
// never expected here: taskCreateSchema requires at least one slot, and the
// slot member picker only offers active members (spec-1-5-admin-task-creation.md's
// I/O Matrix calls both "backstops the UI never reaches"). A caller who gets
// past those some other way, or any other database or network failure, maps
// to the generic tasks.create_failed instead of a raw error code.
//
// tasks.duplicate_slot is different: taskCreateSchema's own refine catches a
// repeated (role, memberId) pair before submission, but a caller that
// bypasses the form still hits task_assignments' unique constraint, so
// actions.ts maps that specific Postgres error (23505) to this code instead
// of the generic one.
export const TASK_ERROR_COPY = {
  "auth.not_active": "Sign in to do that.",
  "tasks.not_admin": "Only the Editorial Board can create tasks.",
  "tasks.duplicate_slot": "The same member already has that role — remove one.",
  "tasks.create_failed": "Couldn't create the task. Try again.",
} as const

export type TaskErrorCode = keyof typeof TASK_ERROR_COPY

export function taskErrorMessage(code: TaskErrorCode): string {
  return TASK_ERROR_COPY[code]
}
