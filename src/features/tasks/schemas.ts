import { z } from "zod"

import { Constants } from "@/lib/supabase/database.types"
import { DATETIME_LOCAL_PATTERN } from "@/lib/time"

import { TASK_COLUMNS } from "./status"

// The production_role enum's members, straight from the generated database
// types (Constants, not Enums<...>, since z.enum needs a runtime array, not
// just the type). Not imported from @/features/members: that barrel also
// re-exports queries.ts, which imports "server-only" — fine from actions.ts,
// but this module is also imported by task-form.tsx (a client component) for
// zodResolver, and any *value* import through that barrel would pull
// "server-only" into the client bundle and fail the build. Labels
// (PRODUCTION_ROLE_LABELS) stay resolved server-side instead (see
// queries.ts's TaskFormOptions.roleLabels).
export const PRODUCTION_ROLES = Constants.public.Enums.production_role

const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000
const REFERENCE_URL_MAX = 2048
const REFERENCE_URL_PATTERN = /^https?:\/\/\S+$/

const slotSchema = z.object({
  role: z.enum(PRODUCTION_ROLES),
  memberId: z.uuid(),
})

// What the create and edit forms share: the fields, and at most 20 slots,
// at least one. Zod refuses `.omit` on a refined object, so each schema
// extends these and adds the refines it needs.
const taskFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: "Add a title" })
    .max(TITLE_MAX, { message: `Keep the title under ${TITLE_MAX} characters` }),
  description: z
    .string()
    .max(DESCRIPTION_MAX, {
      message: `Keep the description under ${DESCRIPTION_MAX} characters`,
    })
    .nullable(),
  dueAt: z
    .string()
    .min(1, { message: "Add a due date" })
    .regex(DATETIME_LOCAL_PATTERN, { message: "Add a due date" }),
  referenceUrl: z
    .string()
    .trim()
    .max(REFERENCE_URL_MAX, { message: "That link is too long" })
    .regex(REFERENCE_URL_PATTERN, { message: "Enter a valid link" })
    .nullable(),
})

function slotsSchema<T extends z.ZodType>(slot: T) {
  return z
    .array(slot)
    .min(1, { message: "Add at least one slot" })
    .max(20, { message: "That's too many slots for one task" })
}

// The same (role, member) twice, which the database refuses too.
function hasNoRepeatedPair(data: {
  slots: { role: string; memberId: string }[]
}) {
  const pairs = data.slots.map((slot) => `${slot.role}:${slot.memberId}`)
  return new Set(pairs).size === pairs.length
}

const REPEATED_PAIR = {
  message: "The same member already has that role — remove one",
  path: ["slots"],
}

/**
 * The admin task-creation form's shape. Mirrors the database limits in
 * supabase/migrations/<ts>_tasks_tasks.sql exactly (title <= 200, description
 * <= 5000, reference_url `^https?://\S+$` <= 2048, at least one slot), so a
 * submission that passes this never reaches the database's CHECK
 * constraints, which stay as the backstop for a caller that bypasses the UI.
 *
 * `owningSectionId`/`owningDeskId` mirror create_task's own two parameters:
 * exactly one is non-null (refined below). The Writers desk is never a valid
 * value here — the owner <select> simply never offers it, so there's no
 * client-side rule to state; tasks_owner_not_writers is the backstop.
 */
export const taskCreateSchema = taskFieldsSchema
  .extend({
    owningSectionId: z.string().nullable(),
    owningDeskId: z.string().nullable(),
    slots: slotsSchema(slotSchema),
  })
  .refine(
    (data) => Number(data.owningSectionId !== null) + Number(data.owningDeskId !== null) === 1,
    { message: "Choose one owner", path: ["owningSectionId"] }
  )
  .refine(hasNoRepeatedPair, REPEATED_PAIR)

/**
 * A slot in the edit form: an existing slot carries its id (its role is
 * fixed) and `loadedMemberId`, the member the form loaded it with, so
 * update_task can refuse a save made over a reassignment since (Story 3.3);
 * a new one has neither.
 */
const slotUpdateSchema = slotSchema
  .extend({ id: z.uuid().optional(), loadedMemberId: z.uuid().optional() })
  .refine(
    (slot) => (slot.id === undefined) === (slot.loadedMemberId === undefined),
    { path: ["loadedMemberId"] }
  )

/**
 * The task form in edit mode (Story 3.7): the task, the same fields and slot
 * rules as create, and no owner, which is fixed at creation. update_task
 * diffs the slots by id; the database refuses a repeated pair too.
 */
export const taskUpdateSchema = taskFieldsSchema
  .extend({
    taskId: z.uuid(),
    slots: slotsSchema(slotUpdateSchema),
  })
  .refine(hasNoRepeatedPair, REPEATED_PAIR)

export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskSlotInput = z.infer<typeof slotSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
export type TaskUpdateSlotInput = z.infer<typeof slotUpdateSchema>

// Mirrors assignment_reasons_reason_format (<ts>_tasks_responses_and_moves.sql).
const REASON_MAX = 280

/**
 * A slot response (I'm on it / Can't take this). The reason is trimmed,
 * capped like the database's own CHECK, and a blank one becomes null;
 * respondToSlotAction sends it only with `needs_reassignment`.
 */
export const slotRespondSchema = z.object({
  slotId: z.uuid(),
  response: z.enum(["on_it", "needs_reassignment"]),
  reason: z
    .string()
    .trim()
    .max(REASON_MAX, {
      message: `Keep the reason under ${REASON_MAX} characters`,
    })
    .nullish()
    .transform((reason) => (reason ? reason : null)),
})

/** Hand back (Story 1.11): the caller's own On it slot, optional reason. */
export const slotHandBackSchema = z.object({
  slotId: z.uuid(),
  reason: slotRespondSchema.shape.reason,
})

/**
 * A column move ("Move to…"). `done` stays a valid value: move_task refuses
 * it, and task_capabilities never offers it.
 */
export const taskMoveSchema = z.object({
  taskId: z.uuid(),
  toColumn: z.enum(TASK_COLUMNS),
})

/** Mark done and Reopen: the approver's commands that take only the task. */
export const taskReviewSchema = z.object({
  taskId: z.uuid(),
})

// Mirrors tasks_revision_note_format (<ts>_tasks_approver_review.sql).
export const REVISION_NOTE_MAX = 5000

/**
 * Send back with note: the note is trimmed and required, and capped like the
 * database's own CHECK. The blank-note message is the dialog's inline error;
 * the textarea's maxLength keeps the cap from being reached.
 */
export const taskSendBackSchema = z.object({
  taskId: z.uuid(),
  note: z
    .string()
    .trim()
    .min(1, { message: "Add a note so they know what to fix." })
    .max(REVISION_NOTE_MAX),
})

/**
 * Delete: the task and the version (`updated_at`) its confirmation was
 * rendered from (AD-21). The version stays the string PostgREST returned,
 * microseconds and all: a `Date` would drop them, and delete_task would then
 * call every delete stale.
 */
export const taskDeleteSchema = z.object({
  taskId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

/**
 * Reassign (Story 3.3): the slot, the member it goes to, and the slot's
 * version (`updated_at`) the picker was rendered from (AD-21), kept as the
 * string PostgREST returned for the same reason as taskDeleteSchema's.
 */
export const slotReassignSchema = z.object({
  slotId: z.uuid(),
  memberId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export type SlotRespondInput = z.input<typeof slotRespondSchema>
export type SlotHandBackInput = z.input<typeof slotHandBackSchema>
export type TaskMoveInput = z.input<typeof taskMoveSchema>
export type TaskReviewInput = z.input<typeof taskReviewSchema>
export type TaskSendBackInput = z.input<typeof taskSendBackSchema>
export type TaskDeleteInput = z.input<typeof taskDeleteSchema>
export type SlotReassignInput = z.input<typeof slotReassignSchema>
