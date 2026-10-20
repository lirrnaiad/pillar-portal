import { z } from "zod"

import { PERSONA_KEYS } from "./personas"
import {
  EDITOR_IN_CHIEF_POSITION_ID,
  OFFERED_POSITION_COUNT,
} from "./position-groups"

/** The persona button a visitor pressed on /login. */
export const personaSignInSchema = z.object({
  persona: z.enum(PERSONA_KEYS),
})

export type PersonaSignInInput = z.infer<typeof personaSignInSchema>

// A `positions` id: the slug shape its CHECK allows.
const positionId = z.string().regex(/^[a-z][a-z0-9_]*$/)

/**
 * An approval from /admin/members: the pending member, one or more offered
 * positions (never Editor-in-Chief), and the primary among them.
 * approve_member checks all of it again, and that the member is still
 * pending.
 */
export const memberApproveSchema = z
  .object({
    memberId: z.uuid(),
    positions: z
      .array(positionId.refine((id) => id !== EDITOR_IN_CHIEF_POSITION_ID))
      .min(1)
      .max(OFFERED_POSITION_COUNT),
    primaryPosition: positionId,
  })
  .refine((input) => input.positions.includes(input.primaryPosition), {
    path: ["primaryPosition"],
  })

export type MemberApproveInput = z.infer<typeof memberApproveSchema>

/** A decline from /admin/members. */
export const memberDeclineSchema = z.object({
  memberId: z.uuid(),
})

export type MemberDeclineInput = z.infer<typeof memberDeclineSchema>
