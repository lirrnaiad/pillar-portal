// Error codes the tasks slice's actions return, and the copy each one shows.
// Raw Postgres errors never reach the UI (mirrors
// src/features/members/errors.ts).
//
// tasks.no_slots and tasks.invalid_slot_member are raised by create_task but
// never expected from it: taskCreateSchema requires at least one slot, and
// the slot member picker only offers active members (spec-1-5-admin-task-creation.md's
// I/O Matrix calls both "backstops the UI never reaches"). A caller who gets
// past those some other way, or any other database or network failure, maps
// to the generic tasks.create_failed instead of a raw error code.
//
// tasks.duplicate_slot is different: taskCreateSchema's own refine catches a
// repeated (role, memberId) pair before submission, but a caller that
// bypasses the form still hits task_assignments' unique constraint, so
// actions.ts maps that specific Postgres error (23505) to this code instead
// of the generic one.
//
// respond_to_slot and move_task raise tasks.not_found and tasks.not_allowed.
// A refused response or move is one the page shouldn't have offered (the
// page's state was stale), so it gets the same "try again" copy as any other
// failure, tasks.save_failed, and the page refreshes.
//
// mark_done, send_back_task and reopen_task raise tasks.not_approver when the
// caller isn't the task's approver, and tasks.stale when they are but the
// task has left the column the command needs (another approver acted
// first): EXPERIENCE.md's stale line, as the members slice shows it, and the
// page refreshes. send_back_task's tasks.invalid_note is a backstop
// taskSendBackSchema keeps the UI from reaching, so it maps to
// tasks.save_failed.
//
// update_task raises the same approver codes, tasks.stale when the form
// holds a slot that is gone (or one appeared while it saved), and
// tasks.duplicate_slot from its own check (a backstop like create's:
// taskUpdateSchema's refine catches the pair first). Its
// tasks.invalid_slot_member means a member the form offered has left since
// it loaded, so it shows the stale line and the page refreshes. Its
// tasks.not_allowed is a slot change on a Done task, whose form offers none
// (the task was marked Done while the form was open): "try again", and the
// refresh shows its slots read-only. Its tasks.no_slots backstop maps to
// tasks.save_failed. Since Story 3.3 it also raises tasks.stale when a slot
// the form loaded has another member now.
//
// reassign_slot raises the approver codes; tasks.stale when the slot changed
// since the picker loaded; tasks.invalid_slot_member (the stale line) when
// the member left meanwhile; tasks.not_allowed when the task was marked Done
// meanwhile ("try again", and the refresh takes Reassign away); and
// tasks.duplicate_slot, which the picker shows with the picked member's name
// instead of this copy.
const STALE_COPY =
  "Something changed since you opened this. Review the latest and try again."

export const TASK_ERROR_COPY = {
  "auth.not_active": "Sign in to do that.",
  "tasks.not_admin": "Only the Editorial Board can create tasks.",
  "tasks.duplicate_slot": "The same member already has that role — remove one.",
  "tasks.create_failed": "Couldn't save — try again.",
  "tasks.not_found": "This task was deleted or the link is wrong.",
  "tasks.not_allowed": "Couldn't save — try again.",
  "tasks.save_failed": "Couldn't save — try again.",
  "tasks.not_approver": "Only the task's head or a top editor can do that.",
  "tasks.stale": STALE_COPY,
  "tasks.invalid_slot_member": STALE_COPY,
} as const

export type TaskErrorCode = keyof typeof TASK_ERROR_COPY

export function taskErrorMessage(code: TaskErrorCode): string {
  return TASK_ERROR_COPY[code]
}
