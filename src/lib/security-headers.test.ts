import { describe, expect, it } from "vitest"

import { securityHeaders } from "./security-headers"

const STAGING = {
  supabaseUrl: "https://abcdefghijklmnop.supabase.co",
  siteUrl: "https://pillar-portal-staging.vercel.app",
  isDev: false,
}

function header(headers: ReturnType<typeof securityHeaders>, key: string) {
  const matches = headers.filter((h) => h.key === key)
  expect(matches).toHaveLength(1)
  return matches[0].value
}

/** The CSP as a map of directive name to its sources. */
function csp(options: Parameters<typeof securityHeaders>[0]) {
  const value = header(securityHeaders(options), "Content-Security-Policy")
  return new Map(
    value.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ")
      return [name, sources] as const
    })
  )
}

describe("securityHeaders", () => {
  it("sends nosniff and a same-origin referrer policy", () => {
    const headers = securityHeaders(STAGING)
    expect(header(headers, "X-Content-Type-Options")).toBe("nosniff")
    expect(header(headers, "Referrer-Policy")).toBe("same-origin")
    expect(headers.map((h) => h.key).sort()).toEqual([
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
    ])
  })

  it("builds the production CSP for an https site", () => {
    expect(header(securityHeaders(STAGING), "Content-Security-Policy")).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://abcdefghijklmnop.supabase.co",
        "font-src 'self'",
        "connect-src 'self' https://abcdefghijklmnop.supabase.co wss://abcdefghijklmnop.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    )
  })

  it("allows no origin but self and Supabase", () => {
    const allowed = new Set([
      "'self'",
      "'none'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "data:",
      "blob:",
      "https://abcdefghijklmnop.supabase.co",
      "wss://abcdefghijklmnop.supabase.co",
    ])
    for (const isDev of [false, true]) {
      for (const sources of csp({ ...STAGING, isDev }).values()) {
        for (const source of sources) expect(allowed).toContain(source)
      }
    }
  })

  it("forbids framing", () => {
    expect(csp(STAGING).get("frame-ancestors")).toEqual(["'none'"])
  })

  it("adds 'unsafe-eval' in development only", () => {
    expect(csp(STAGING).get("script-src")).not.toContain("'unsafe-eval'")
    expect(csp({ ...STAGING, isDev: true }).get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ])
  })

  it("uses the local Supabase origin over http and ws", () => {
    const local = csp({
      supabaseUrl: "http://127.0.0.1:54321",
      siteUrl: "http://localhost:3000",
      isDev: true,
    })
    expect(local.get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ])
    expect(local.get("img-src")).toContain("http://127.0.0.1:54321")
  })

  it("reduces the Supabase URL to its origin", () => {
    const sources = csp({
      ...STAGING,
      supabaseUrl: "https://abcdefghijklmnop.supabase.co/rest/v1/?x=1",
    }).get("connect-src")
    expect(sources).toEqual([
      "'self'",
      "https://abcdefghijklmnop.supabase.co",
      "wss://abcdefghijklmnop.supabase.co",
    ])
  })

  it("upgrades insecure requests only when the site is https", () => {
    expect(csp(STAGING).has("upgrade-insecure-requests")).toBe(true)
    expect(
      csp({ ...STAGING, siteUrl: "http://localhost:3000" }).has(
        "upgrade-insecure-requests"
      )
    ).toBe(false)
  })
})
