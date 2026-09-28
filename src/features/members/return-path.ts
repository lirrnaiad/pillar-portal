import { clientEnv } from "@/lib/env.client"

const FALLBACK = "/dashboard"

/**
 * Where to go after sign-in, from a `next` value the visitor controls (AD-7).
 * Every accepted `next` goes through here.
 *
 * Returns a same-origin path (`pathname + search + hash`), or `/dashboard`
 * when `next` isn't a non-empty string, doesn't parse against
 * NEXT_PUBLIC_SITE_URL, or resolves to another origin or scheme. The path is
 * relative, so preview deploys and soft navigation keep the current origin.
 * The path is never decoded: `/%2F%2Fx` stays `/%2F%2Fx`.
 *
 * A same-origin URL can still have a pathname starting with `//`
 * (`/.//x` resolves to `//x`), which as a relative `Location` means another
 * host, so that falls back too.
 */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== "string" || next === "") return FALLBACK

  const site = new URL(clientEnv.NEXT_PUBLIC_SITE_URL)
  let url: URL
  try {
    url = new URL(next, site)
  } catch {
    return FALLBACK
  }
  // A `blob:` URL takes its inner URL's origin, so `blob:<site>/x` passes the
  // origin check; its protocol differs.
  if (url.origin !== site.origin || url.protocol !== site.protocol) {
    return FALLBACK
  }

  const path = url.pathname + url.search + url.hash
  return path.startsWith("//") ? FALLBACK : path
}
