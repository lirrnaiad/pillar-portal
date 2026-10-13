// The security headers next.config.ts serves on every route: pages and route
// handlers alike. A pure function of its inputs, so it can be tested without
// Next. next.config.ts loads this file directly, so keep imports to packages
// only (no `@/`).
//
// The CSP is static (no nonce). That means `'unsafe-inline'` for scripts,
// which Next's inline bootstrap needs, and `'unsafe-eval'` in development,
// which React needs for debugging. The only other origin allowed is Supabase,
// over http(s) and ws(s) for Realtime, plus Google in `form-action`. The
// Vercel toolbar on previews is blocked, which is accepted.
//
// `form-action` (Story 2.1): before hydration, Sign in with Google is a plain
// form post whose Server Action answers 303 to Supabase's /authorize, which
// redirects to accounts.google.com, and CSP checks every hop of a form
// submission's redirects. After hydration the action's external redirect is
// a hard navigation, which `form-action` doesn't cover.
//
// Later stories widen this on purpose, in the same change as the feature:
// - Turnstile (Epic 7): https://challenges.cloudflare.com in `script-src`
//   and in a new `frame-src`.
// Not here yet: CSP violation reporting (no `report-to`), and HSTS, which
// Vercel already sends on *.vercel.app; it is decided at go-live for the
// Pillar domain.

export type SecurityHeader = { key: string; value: string }

const GOOGLE_ACCOUNTS = "https://accounts.google.com"

export function securityHeaders({
  supabaseUrl,
  siteUrl,
  isDev,
}: {
  supabaseUrl: string
  siteUrl: string
  isDev: boolean
}): SecurityHeader[] {
  const supabase = new URL(supabaseUrl).origin
  // http: -> ws:, https: -> wss:
  const supabaseRealtime = supabase.replace(/^http/, "ws")

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabaseRealtime}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${supabase} ${GOOGLE_ACCOUNTS}`,
    "frame-ancestors 'none'",
  ]
  if (new URL(siteUrl).protocol === "https:") {
    directives.push("upgrade-insecure-requests")
  }

  return [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
  ]
}
