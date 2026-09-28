"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { personasEnabled, serverEnv } from "@/lib/env.server"
import { createClient } from "@/lib/supabase/server"

import type { MemberErrorCode } from "./errors"
import { PERSONAS } from "./personas"
import { safeReturnPath } from "./return-path"
import { personaSignInSchema } from "./schemas"

/** What the persona form shows after a failed attempt; success redirects. */
export type PersonaSignInState = { ok: false; code: MemberErrorCode } | null

/**
 * Signs in as the persona whose button was pressed, with the password only
 * the server holds (AD-7), then goes to the form's `next` when
 * `safeReturnPath` accepts it, else /dashboard. Refuses without calling Auth
 * unless PROTOTYPE_PERSONAS is on. A bad button value and any Auth failure
 * look the same to the visitor.
 */
export async function signInAsPersonaAction(
  _previous: PersonaSignInState,
  formData: FormData
): Promise<PersonaSignInState> {
  const password = serverEnv.PROTOTYPE_PERSONA_PASSWORD
  if (!personasEnabled || password === undefined) {
    return { ok: false, code: "auth.personas_off" }
  }

  const parsed = personaSignInSchema.safeParse({
    persona: formData.get("persona"),
  })
  if (!parsed.success) return { ok: false, code: "auth.sign_in_failed" }

  let signedIn = false
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: PERSONAS[parsed.data.persona].email,
      password,
    })
    signedIn = error === null
  } catch {
    signedIn = false
  }
  if (!signedIn) return { ok: false, code: "auth.sign_in_failed" }

  // redirect() throws, so it stays outside the try.
  redirect(safeReturnPath(formData.get("next")))
}

/**
 * Ends this browser's session only. Personas are shared accounts, so a global
 * sign-out would sign out everyone else using the same persona.
 *
 * supabase-js `signOut()` reports most failures as a returned `{ error }` and
 * then leaves the session cookies in place. On any failure, returned or
 * thrown, this deletes the browser's auth cookies itself, so the visitor is
 * signed out here even when Auth can't be reached.
 */
export async function signOutAction(): Promise<void> {
  let failed: boolean
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signOut({ scope: "local" })
    failed = error !== null
  } catch {
    failed = true
  }
  if (failed) await deleteAuthCookies()

  redirect("/login")
}

// The @supabase/ssr session cookies: `sb-<ref>-auth-token`, its `.0`, `.1`...
// chunks, and `sb-<ref>-auth-token-code-verifier`.
async function deleteAuthCookies() {
  const cookieStore = await cookies()
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-") && name.includes("-auth-token")) {
      cookieStore.delete(name)
    }
  }
}
