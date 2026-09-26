// Runs once when a Next.js server instance starts, before it serves requests.
//
// - env.server: this is where server-only variables are checked at start
//   (`next build` never calls register()). A bad value fails every request.
// - env.client: NEXT_PUBLIC_* values are inlined at build time, so this only
//   re-checks the value the build baked in. The start-time refusal of a
//   missing or malformed NEXT_PUBLIC_SITE_URL comes from next.config.ts,
//   which imports env.client when `next dev`, `next build` or `next start`
//   loads the config.
export async function register() {
  await import("@/lib/env.server")
  await import("@/lib/env.client")
}
