import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import { clientEnv } from "@/lib/env.client"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Runs before every request under /dashboard and /admin (AD-7).
 *
 * - Refreshes the session: `getClaims()` refreshes an expired access token,
 *   and the new cookies go both on the response (for the browser) and onto
 *   the request (so the render sees the new token). Server Components can't
 *   write cookies, so without this a persona is signed out after about an
 *   hour.
 * - Sends a signed-out GET or HEAD to `/login?next=<path and query>`, built
 *   from NEXT_PUBLIC_SITE_URL, never from the request's host. Other methods
 *   (Server Action POSTs) pass through.
 *
 * It only routes: the layouts, RLS and the commands still decide access, so a
 * `getClaims()` that throws passes the request through to them.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  // The headers @supabase/ssr passes with a session write (today the no-store
  // Cache-Control, Expires and Pragma, on the first write only). They keep a
  // response carrying one visitor's session out of any shared cache, so every
  // response here that carries the session gets all of them.
  const sessionHeaders: Record<string, string> = {}

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
          Object.assign(sessionHeaders, headers)
          for (const [key, value] of Object.entries(sessionHeaders)) {
            response.headers.set(key, value)
          }
        },
      },
    }
  )

  let signedIn: boolean
  try {
    const { data } = await supabase.auth.getClaims()
    // An Auth error getClaims() returns counts as signed out: a dead refresh
    // token, or AuthRetryableFetchError while Auth is unreachable. The
    // redirect keeps `next`, and a retryable error leaves the session cookies
    // in place, so /login sends the member on once Auth is back. Only a throw
    // passes through.
    signedIn = Boolean(data?.claims.sub)
  } catch {
    return response
  }

  if (signedIn) return response
  if (request.method !== "GET" && request.method !== "HEAD") return response

  const login = new URL("/login", clientEnv.NEXT_PUBLIC_SITE_URL)
  login.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search
  )
  // 307. It carries any session cookies the attempt wrote, such as the
  // deletions after a dead refresh token, and the headers that came with them.
  const redirect = NextResponse.redirect(login)
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
  for (const [key, value] of Object.entries(sessionHeaders)) {
    redirect.headers.set(key, value)
  }
  return redirect
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
}
