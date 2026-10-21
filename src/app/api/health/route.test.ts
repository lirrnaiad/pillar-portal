import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { abortSignal, createAdminClient, rpc } = vi.hoisted(() => {
  const abortSignal = vi.fn()
  const rpc = vi.fn(() => ({ abortSignal }))
  return { abortSignal, createAdminClient: vi.fn(() => ({ rpc })), rpc }
})

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }))

import { GET } from "./route"

// Like postgrest-js: once its signal aborts, the call settles with an error
// (and never before).
function hangUntilAborted() {
  abortSignal.mockImplementation(
    (signal: AbortSignal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () =>
          resolve({
            data: null,
            error: { code: "20", name: "AbortError", message: "aborted" },
          })
        )
      })
  )
}

async function expectDown(response: Response) {
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("content-type")).toMatch(/^application\/json/)
  expect(await response.json()).toEqual({ status: "error" })
}

beforeEach(() => {
  abortSignal.mockResolvedValue({ data: true, error: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("GET /api/health", () => {
  it("pings health_check, then returns 200 with only status and a UTC ISO-8601 timestamp", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-26T04:05:06.789Z"))

    const response = await GET()

    expect(rpc).toHaveBeenCalledExactlyOnceWith("health_check")
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("content-type")).toMatch(/^application\/json/)

    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(["status", "timestamp"])
    expect(body).toEqual({
      status: "ok",
      timestamp: "2026-09-26T04:05:06.789Z",
    })
  })

  it("stamps the current time, ending in Z", async () => {
    const body = await (await GET()).json()
    expect(body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })

  it("returns 503 when the database doesn't answer within 5 seconds, aborting the call", async () => {
    vi.useFakeTimers()
    hangUntilAborted()

    const pending = GET()
    await vi.advanceTimersByTimeAsync(4999)
    const signal = abortSignal.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    await expectDown(await pending)
  })

  it("returns 503 at 5 seconds even when the call ignores its abort signal", async () => {
    vi.useFakeTimers()
    abortSignal.mockReturnValue(new Promise(() => {}))

    const pending = GET()
    await vi.advanceTimersByTimeAsync(5000)

    await expectDown(await pending)
  })

  it("answers within 5 seconds without waiting for the timer when the database answers", async () => {
    vi.useFakeTimers()

    const response = await GET()

    expect(response.status).toBe(200)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [
      "returns an error",
      () =>
        abortSignal.mockResolvedValue({
          data: null,
          error: {
            code: "PGRST301",
            message: "JWT expired",
            details: "secret detail",
          },
        }),
    ],
    [
      "answers something other than true",
      () => abortSignal.mockResolvedValue({ data: false, error: null }),
    ],
    [
      "answers nothing",
      () => abortSignal.mockResolvedValue({ data: null, error: null }),
    ],
    [
      "throws",
      () => abortSignal.mockRejectedValue(new TypeError("fetch failed")),
    ],
    [
      "can't be reached by a client",
      () =>
        createAdminClient.mockImplementationOnce(() => {
          throw new Error("no client")
        }),
    ],
  ])(
    "returns 503 with no details when the database %s",
    async (_label, fail) => {
      fail()

      const response = await GET()

      await expectDown(response)
    }
  )
})
