import { describe, expect, it, vi } from "vitest"

import { safeReturnPath } from "./return-path"

vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

describe("safeReturnPath", () => {
  it.each([
    ["a member path with a query", "/dashboard?view=board"],
    ["a deep link with a query and a fragment", "/dashboard/tasks/abc?x=1#h"],
    ["an admin path", "/admin/members"],
  ])("keeps %s", (_label, next) => {
    expect(safeReturnPath(next)).toBe(next)
  })

  it("keeps an encoded path as it is, never decoding it", () => {
    expect(safeReturnPath("/%2F%2Fx")).toBe("/%2F%2Fx")
  })

  it("turns an absolute URL on the site's own origin into its path", () => {
    expect(
      safeReturnPath("https://pillar.example/dashboard/tasks/abc?x=1#h")
    ).toBe("/dashboard/tasks/abc?x=1#h")
  })

  it.each([
    ["a protocol-relative URL", "//x"],
    ["a backslash the URL parser reads as a slash", "/\\x"],
    ["a tab the URL parser drops", "/\t/x"],
    ["another origin", "https://evil.example/"],
    ["the site's host over another scheme", "http://pillar.example/dashboard"],
    ["a same-origin path that resolves to //x", "/.//x"],
    ["a same-origin path that climbs to //x", "/..//x"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,hi"],
    // A blob: URL's origin is its inner URL's, so only the scheme differs.
    ["a blob: URL on the site's origin", "blob:https://pillar.example/x"],
    [
      "a blob: URL whose path starts with //",
      "blob:https://pillar.example//evil.example",
    ],
    ["an empty string", ""],
    ["a URL that doesn't parse", "http://["],
  ])("sends %s to /dashboard", (_label, next) => {
    expect(safeReturnPath(next)).toBe("/dashboard")
  })

  it.each([
    ["missing", undefined],
    ["null (FormData.get of a missing field)", null],
    ["an array (a repeated query parameter)", ["/dashboard?view=board"]],
    ["a number", 42],
    ["a File", new File(["x"], "next.txt")],
  ])("sends a next that is %s to /dashboard", (_label, next) => {
    expect(safeReturnPath(next)).toBe("/dashboard")
  })
})
