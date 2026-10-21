import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// One query as the stub saw it: the table, then every builder call in order,
// e.g. ["eq", "job", "backup"].
type Query = { table: string; calls: unknown[][] }

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { state, createClient } = vi.hoisted(() => {
  const state = {
    production: true,
    queries: [] as Query[],
    // What the query's maybeSingle() resolves to.
    result: { data: null, error: null } as { data: unknown; error: unknown },
  }
  const from = (table: string) => {
    const query: Query = { table, calls: [] }
    state.queries.push(query)
    const record =
      (name: string) =>
      (...args: unknown[]) => (query.calls.push([name, ...args]), builder)
    const builder = {
      select: record("select"),
      eq: record("eq"),
      order: record("order"),
      limit: record("limit"),
      maybeSingle: async () => {
        query.calls.push(["maybeSingle"])
        return state.result
      },
    }
    return builder
  }
  return { state, createClient: vi.fn(async () => ({ from })) }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/env.server", () => ({
  get isProduction() {
    return state.production
  },
}))

import { ADMIN_BANNER_SOURCES } from "./admin-banner-sources"
import {
  BACKUP_OVERDUE_DAYS,
  backupBanner,
  backupBannerOf,
} from "./backup-banner"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date("2026-10-21T04:00:00.000Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const NO_BACKUP = {
  id: "backup-overdue",
  family: "attention",
  text: "No backup has run yet.",
  since: "1970-01-01T00:00:00.000Z",
}

beforeEach(() => {
  state.production = true
  state.queries = []
  state.result = { data: null, error: null }
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("backupBannerOf", () => {
  it("counts a backup overdue after 8 days", () => {
    expect(BACKUP_OVERDUE_DAYS).toBe(8)
  })

  it("shows the none banner, since the epoch, when no backup has run", () => {
    expect(backupBannerOf(null, NOW)).toEqual(NO_BACKUP)
  })

  it("shows nothing for a backup exactly 8×24h old", () => {
    expect(backupBannerOf(ago(8 * DAY_MS), NOW)).toBeNull()
  })

  it.each([
    ["a day old", DAY_MS],
    ["a minute old", 60 * 1000],
    ["finished just now", 0],
    ["finished after now (clock skew)", -60 * 1000],
  ])("shows nothing for a backup %s", (_label, age) => {
    expect(backupBannerOf(ago(age), NOW)).toBeNull()
  })

  it("shows the overdue banner 1 ms past 8×24h, since it became overdue", () => {
    const finished = ago(8 * DAY_MS + 1)
    expect(backupBannerOf(finished, NOW)).toEqual({
      id: "backup-overdue",
      family: "attention",
      text: "Last backup was 8 days ago.",
      since: new Date(NOW.getTime() - 1).toISOString(),
    })
  })

  it("counts whole days elapsed: 9.5 days is 9", () => {
    const banner = backupBannerOf(ago(9.5 * DAY_MS), NOW)
    expect(banner).toEqual({
      id: "backup-overdue",
      family: "attention",
      text: "Last backup was 9 days ago.",
      since: ago(1.5 * DAY_MS),
    })
    expect(banner).not.toHaveProperty("cancel")
  })

  it("reads Postgres's timestamptz as PostgREST sends it", () => {
    // 2026-10-11T03:59:59.999Z, more than 10 days before NOW.
    expect(backupBannerOf("2026-10-11T03:59:59.999999+00:00", NOW)?.text).toBe(
      "Last backup was 10 days ago."
    )
  })

  it("throws on a finish time that isn't a timestamp", () => {
    expect(() => backupBannerOf("not a time", NOW)).toThrow(RangeError)
  })
})

describe("backupBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
  })

  it("reads the newest ok backup run through the caller's session", async () => {
    state.result = { data: { finished_at: ago(9 * DAY_MS) }, error: null }

    await expect(backupBanner()).resolves.toEqual([
      {
        id: "backup-overdue",
        family: "attention",
        text: "Last backup was 9 days ago.",
        since: ago(DAY_MS),
      },
    ])
    expect(state.queries).toEqual([
      {
        table: "job_runs",
        calls: [
          ["select", "finished_at"],
          ["eq", "job", "backup"],
          ["eq", "status", "ok"],
          ["order", "finished_at", { ascending: false }],
          ["limit", 1],
          ["maybeSingle"],
        ],
      },
    ])
  })

  it("returns the none banner when no backup has succeeded", async () => {
    await expect(backupBanner()).resolves.toEqual([NO_BACKUP])
  })

  it("returns no banner for a recent backup", async () => {
    state.result = { data: { finished_at: ago(DAY_MS) }, error: null }
    await expect(backupBanner()).resolves.toEqual([])
  })

  it("returns no banner, and queries nothing, outside production", async () => {
    state.production = false

    await expect(backupBanner()).resolves.toEqual([])
    expect(createClient).not.toHaveBeenCalled()
    expect(state.queries).toEqual([])
  })

  it("throws a failed read, with the database error as its cause", async () => {
    const failure = { code: "42501", message: "permission denied" }
    state.result = { data: null, error: failure }

    const error = await backupBanner().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      "backupBanner: reading the last backup failed"
    )
    expect((error as Error).cause).toBe(failure)
  })
})

describe("ADMIN_BANNER_SOURCES", () => {
  // Only #0 is pinned: the slot records a failing source by its index, and a
  // later story appends its own source after this one.
  it("holds the backup banner at index 0", () => {
    expect(ADMIN_BANNER_SOURCES[0]).toBe(backupBanner)
  })
})
