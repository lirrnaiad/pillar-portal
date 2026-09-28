import { z } from "zod"

import { PERSONA_KEYS } from "./personas"

/** The persona button a visitor pressed on /login. */
export const personaSignInSchema = z.object({
  persona: z.enum(PERSONA_KEYS),
})

export type PersonaSignInInput = z.infer<typeof personaSignInSchema>
