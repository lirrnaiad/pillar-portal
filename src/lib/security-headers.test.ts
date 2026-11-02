import { describe, expect, it } from "vitest"

import { securityHeaders } from "./security-headers"

const STAGING = {
  supabaseUrl: "https://abcdefghijklmnop.supabase.co",
  siteUrl: "https://pillar-portal-staging.vercel.app",
  isDev: false,
}

const LOCAL = {
  supabaseUrl: "http://127.0.0.1:54321",
  siteUrl: "http://localhost:3000",
  isDev: true,
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
  })

  it("sends exactly these headers to an https site", () => {
    expect(
      securityHeaders(STAGING)
        .map((h) => h.key)
        .sort()
    ).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
    ])
  })

  it("sends every header except HSTS to an http site", () => {
    for (const isDev of [false, true]) {
      expect(
        securityHeaders({ ...LOCAL, isDev })
          .map((h) => h.key)
          .sort()
      ).toEqual([
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Permissions-Policy",
        "Referrer-Policy",
        "X-Content-Type-Options",
      ])
    }
  })

  it("pins https for two years, without subdomains or preload", () => {
    expect(header(securityHeaders(STAGING), "Strict-Transport-Security")).toBe(
      "max-age=63072000"
    )
  })

  it("sends no HSTS under next dev, even to an https site", () => {
    // `next dev --experimental-https` would pin localhost for two years.
    expect(
      securityHeaders({
        ...LOCAL,
        siteUrl: "https://localhost:3000",
        isDev: true,
      }).some((h) => h.key === "Strict-Transport-Security")
    ).toBe(false)
  })

  it("always turns off camera, microphone, geolocation, payment and USB", () => {
    for (const options of [STAGING, LOCAL]) {
      expect(header(securityHeaders(options), "Permissions-Policy")).toBe(
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
      )
    }
  })

  it("always isolates the window from cross-origin openers", () => {
    for (const options of [STAGING, LOCAL]) {
      expect(
        header(securityHeaders(options), "Cross-Origin-Opener-Policy")
      ).toBe("same-origin")
    }
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
        "form-action 'self' https://abcdefghijklmnop.supabase.co https://accounts.google.com",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    )
  })

  it("allows no origin but self and Supabase, and Google only as a form-action", () => {
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
      for (const [name, sources] of csp({ ...STAGING, isDev })) {
        for (const source of sources) {
          if (
            name === "form-action" &&
            source === "https://accounts.google.com"
          )
            continue
          expect(allowed).toContain(source)
        }
      }
    }
  })

  it("lets a pre-hydration Google sign-in post redirect through Supabase to Google", () => {
    // The Server Action's 303 goes to Supabase's /authorize, which redirects
    // to Google; CSP checks each hop of a form submission.
    expect(csp(STAGING).get("form-action")).toEqual([
      "'self'",
      "https://abcdefghijklmnop.supabase.co",
      "https://accounts.google.com",
    ])
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
    const local = csp(LOCAL)
    expect(local.get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ])
    expect(local.get("img-src")).toContain("http://127.0.0.1:54321")
    expect(local.get("form-action")).toEqual([
      "'self'",
      "http://127.0.0.1:54321",
      "https://accounts.google.com",
    ])
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
