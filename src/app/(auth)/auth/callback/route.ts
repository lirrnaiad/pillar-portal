import { NextResponse, type NextRequest } from "next/server"

import { loginPath, safeReturnPath } from "@/features/members"
import { clientEnv } from "@/lib/env.client"
import { createClient } from "@/lib/supabase/server"

const NO_STORE = "private, no-store"

function redirectTo(path: string) {
  const response = NextResponse.redirect(
    new URL(path, clientEnv.NEXT_PUBLIC_SITE_URL)
  )
  response.headers.set("Cache-Control", NO_STORE)
  return response
}

// The OAuth callback (AD-3), the only redirect URL Supabase Auth allows:
// Google returns here through Auth with a PKCE `code`, exchanged for a
// session with the verifier cookie signInWithGoogleAction set. A first
// sign-in has already created a pending member (the auth.users trigger);
// this writes nothing itself. `next` is checked again before any redirect,
// and absolute URLs come only from NEXT_PUBLIC_SITE_URL.
//
// A cancel (`error=access_denied`), any other `error`, no `code`, a refused
// exchange (a missing verifier included) or a thrown one goes back to /login
// with "Sign-in didn't finish", keeping `next`. /auth isn't proxied.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const next = safeReturnPath(params.get("next"))
  const didntFinish = () => redirectTo(loginPath({ next, error: true }))

  const code = params.get("code")
  if (params.has("error") || !code) return didntFinish()

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return didntFinish()
  } catch (error) {
    console.error("GET /auth/callback: the code exchange threw", error)
    return didntFinish()
  }

  return redirectTo(next)
}
