import { beforeEach, describe, expect, it, vi } from "vitest"

const { after, createClient, getClaims, recordErrorEvent } = vi.hoisted(() => ({
  // Holds each scheduled callback; runAfter() runs them, as Next does once
  // the response is sent.
  after: vi.fn<(task: () => unknown) => void>(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
  recordErrorEvent: vi.fn(async () => {}),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

// The members barrel's actions.ts reads the server-only env, which requires
// SUPABASE_SECRET_KEY; these tests use none of the actions.
vi.mock("@/features/members/actions", () => ({}))

import { GET } from "./route"

const ID = "00000000-0000-4000-8000-000000000021"

type Result = { data: unknown; error: unknown }

function setup(
  task: Result,
  claims: Result = { data: { claims: { sub: "u" } }, error: null }
) {
  getClaims.mockResolvedValue(claims)
  const maybeSingle = vi.fn().mockResolvedValue(task)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  createClient.mockResolvedValue({ auth: { getClaims }, from })
  return { from }
}

const ROW = {
  id: ID,
  title: "Lay out the spread",
  description: "a, b; c\nnext",
  due_at: "2026-10-10T09:00:00+00:00",
  reference_url: null,
}

const call = (id = ID, query = "") =>
  GET(new Request(`https://pillar.example/api/tasks/${id}/ics${query}`), {
    params: Promise.resolve({ id }),
  } as never)

beforeEach(() => vi.clearAllMocks())

describe("GET /api/tasks/[id]/ics", () => {
  it("serves the file with two alarms", async () => {
    setup({ data: ROW, error: null })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8")
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="[\x20-\x7e]+"$/
    )
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body = await res.text()
    expect(body).toContain("DTSTART:20261010T090000Z")
    expect(body).toMatch(/^TRIGGER:-P1D\r?$/m)
    expect(body).toMatch(/^TRIGGER:-PT1H\r?$/m)
    expect(body).not.toContain("-P1DT")
    expect(body).toContain("a\\, b\\; c\\nnext")
  })

  it("redirects to Google with ?to=google", async () => {
    setup({ data: ROW, error: null })
    const res = await call(ID, "?to=google")
    expect(res.status).toBe(302)
    const location = res.headers.get("location")!
    expect(location).toContain("https://calendar.google.com/calendar/render?")
    expect(location).toContain("dates=20261010T090000Z/20261010T091500Z")
    expect(location).toContain("%2C")
    expect(location).toContain("%3B")
    expect(location).toContain("%0A")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("ignores any other ?to value", async () => {
    setup({ data: ROW, error: null })
    const res = await call(ID, "?to=outlook")
    expect(res.status).toBe(200)
  })

  it("answers 404 with the same body for every miss", async () => {
    const bodies: string[] = []
    const statuses: number[] = []
    const record = async (res: Response) => {
      statuses.push(res.status)
      bodies.push(await res.text())
    }

    setup({ data: ROW, error: null }, { data: null, error: null })
    await record(await call())

    const { from } = setup({ data: ROW, error: null })
    await record(await call("not-a-uuid"))
    expect(from).not.toHaveBeenCalled()

    setup({ data: null, error: null })
    await record(await call())

    setup({ data: null, error: { message: "boom" } })
    await record(await call())

    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    createClient.mockRejectedValue(new Error("boom"))
    await record(await call())
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()

    expect(statuses).toEqual([404, 404, 404, 404, 404])
    expect(new Set(bodies).size).toBe(1)
  })

  // RLS hides a deleted task from every caller: the read returns no row.
  it("answers 404 for a deleted task, recording nothing", async () => {
    setup({ data: null, error: null })

    const res = await call()

    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(after).not.toHaveBeenCalled()
  })

  it("records a thrown read after the response, and nothing for the other misses", async () => {
    setup({ data: ROW, error: null }, { data: null, error: null })
    await call()
    setup({ data: null, error: { message: "boom" } })
    await call()
    expect(after).not.toHaveBeenCalled()

    const thrown = new Error("boom")
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    createClient.mockRejectedValue(thrown)
    const res = await call()
    spy.mockRestore()

    expect(res.status).toBe(404)
    expect(recordErrorEvent).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    for (const [task] of after.mock.calls) await task()
    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(thrown, {
      route: "route /api/tasks/[id]/ics",
    })
  })

  it("records nothing for a served file", async () => {
    setup({ data: ROW, error: null })
    await call()

    expect(after).not.toHaveBeenCalled()
  })
})
