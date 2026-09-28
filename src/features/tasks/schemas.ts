import { z } from "zod"

import { Constants } from "@/lib/supabase/database.types"
import { DATETIME_LOCAL_PATTERN } from "@/lib/time"

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
export const taskCreateSchema = z
  .object({
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
    owningSectionId: z.string().nullable(),
    owningDeskId: z.string().nullable(),
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
    slots: z
      .array(slotSchema)
      .min(1, { message: "Add at least one slot" })
      .max(20, { message: "That's too many slots for one task" }),
  })
  .refine(
    (data) => Number(data.owningSectionId !== null) + Number(data.owningDeskId !== null) === 1,
    { message: "Choose one owner", path: ["owningSectionId"] }
  )
  .refine(
    (data) => {
      const pairs = data.slots.map((slot) => `${slot.role}:${slot.memberId}`)
      return new Set(pairs).size === pairs.length
    },
    {
      message: "The same member already has that role — remove one",
      path: ["slots"],
    }
  )

export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskSlotInput = z.infer<typeof slotSchema>
