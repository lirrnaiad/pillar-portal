import { afterEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/health", () => {
  it("returns 200 with only status and a UTC ISO-8601 timestamp", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-26T04:05:06.789Z"))

    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toMatch(/^application\/json/)

    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(["status", "timestamp"])
    expect(body).toEqual({
      status: "ok",
      timestamp: "2026-09-26T04:05:06.789Z",
    })
  })

  it("stamps the current time, ending in Z", async () => {
    const body = await GET().json()
    expect(body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })
})
