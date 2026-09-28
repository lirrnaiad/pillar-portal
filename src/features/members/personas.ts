// The prototype personas (AD-7): shared Supabase Auth users that anyone on
// /login can sign in as while PROTOTYPE_PERSONAS is on. Each key is the
// position the persona holds. supabase/seed.sql creates them locally and
// scripts/staging-personas.mjs creates them on staging; both use these emails
// and names (members-data.test.ts checks seed.sql).
//
// No imports: scripts/staging-personas.mjs loads this file directly under
// Node, which strips the types.
export const PERSONAS = {
  staff_layout_artist: {
    label: "Staff Layout Artist",
    name: "Staff Layout Artist",
    email: "persona-staff_layout_artist@example.com",
  },
  head_layout_artist: {
    label: "Head Layout Artist",
    name: "Head Layout Artist",
    email: "persona-head_layout_artist@example.com",
  },
  editor_in_chief: {
    label: "Editor-in-Chief",
    name: "Editor-in-Chief",
    email: "persona-editor_in_chief@example.com",
  },
} as const

export type PersonaKey = keyof typeof PERSONAS

export const PERSONA_KEYS = Object.keys(PERSONAS) as [
  PersonaKey,
  ...PersonaKey[],
]
