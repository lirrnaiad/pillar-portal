import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER } from "next/constants"

// Importing env.client validates NEXT_PUBLIC_* at config load, so
// `next build`, `next dev` and `next start` stop with the variable named when
// one is missing or malformed.
import { clientEnv } from "./src/lib/env.client"
import { securityHeaders } from "./src/lib/security-headers"

// A phase function, so development is known without reading process.env.
export default function nextConfig(phase: string): NextConfig {
  const headers = securityHeaders({
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
    isDev: phase === PHASE_DEVELOPMENT_SERVER,
  })

  return {
    // Every route: pages, route handlers and static files.
    async headers() {
      return [{ source: "/:path*", headers }]
    },
  }
}
