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
//
// The rest (decided at go live, Story 3.5; OPERATIONS.md section 2, step 15):
// - `Strict-Transport-Security`, two years, for an https site outside
//   `next dev` only. Browsers ignore it over http, so the guard that matters
//   is development: `next dev --experimental-https` with an https localhost
//   site URL would otherwise pin localhost to https for two years. No
//   `includeSubDomains`, so only the app's own hostname is held to https,
//   not the rest of the Pillar domain, and so no `preload`, which needs it.
// - `Permissions-Policy` turns off the powerful features the portal never
//   uses.
// - `Cross-Origin-Opener-Policy: same-origin`: sign-in is a redirect, never
//   a popup, so no other origin needs a handle on this window.
// - No CSP violation reporting (no `report-to`): `error_events` holds server
//   faults only, never anything from the browser.

export type SecurityHeader = { key: string; value: string }

const GOOGLE_ACCOUNTS = "https://accounts.google.com"

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()"

// Two years.
const HSTS = "max-age=63072000"

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
  const isHttps = new URL(siteUrl).protocol === "https:"
  if (isHttps) {
    directives.push("upgrade-insecure-requests")
  }

  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ]
  if (isHttps && !isDev) {
    headers.push({ key: "Strict-Transport-Security", value: HSTS })
  }
  return headers
}
