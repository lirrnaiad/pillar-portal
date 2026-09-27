// The security headers next.config.ts serves on every route: pages and route
// handlers alike. A pure function of its inputs, so it can be tested without
// Next. next.config.ts loads this file directly, so keep imports to packages
// only (no `@/`).
//
// The CSP is static (no nonce). That means `'unsafe-inline'` for scripts,
// which Next's inline bootstrap needs, and `'unsafe-eval'` in development,
// which React needs for debugging. The only other origin allowed is Supabase,
// over http(s) and ws(s) for Realtime. The Vercel toolbar on previews is
// blocked, which is accepted.
//
// Later stories widen this on purpose, in the same change as the feature:
// - Turnstile (Epic 7): https://challenges.cloudflare.com in `script-src`
//   and in a new `frame-src`.
// - OAuth sign-in (Story 2.1): a form-submitted Server Action that redirects
//   to the provider can be blocked by `form-action 'self'`; check the flow in
//   a browser and allow the provider's origin only if it is.
// Not here yet: CSP violation reporting (no `report-to`), and HSTS, which
// Vercel already sends on *.vercel.app; it is decided at go-live for the
// Pillar domain.

export type SecurityHeader = { key: string; value: string }

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
    "form-action 'self'",
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
