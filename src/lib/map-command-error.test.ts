import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { after, recordErrorEvent } = vi.hoisted(() => ({
  after: vi.fn<(task: () => unknown) => void>(),
  recordErrorEvent: vi.fn(async () => {}),
}))

vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))

import { mapCommandError } from "./map-command-error"

type Code = "auth.not_active" | "things.stale" | "things.save_failed"

const KNOWN: ReadonlySet<Code> = new Set(["auth.not_active", "things.stale"])
const WHERE = {
  route: "action saveThingAction",
  entityType: "thing",
  entityId: "00000000-0000-4000-8000-000000000001",
}

async function runAfter() {
  for (const [task] of after.mock.calls) await task()
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("mapCommandError", () => {
  it.each(["auth.not_active", "things.stale"] as const)(
    "returns the known code %s as is and records nothing",
    async (code) => {
      const error = { code: "P0001", message: code }

      expect(mapCommandError(error, KNOWN, "things.save_failed", WHERE)).toBe(
        code
      )

      await runAfter()
      expect(after).not.toHaveBeenCalled()
      expect(recordErrorEvent).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      "a code the UI never expects",
      { code: "P0001", message: "things.backstop" },
    ],
    [
      "a raw database error",
      { code: "42501", message: "permission denied for table things" },
    ],
    ["a network failure", { message: "TypeError: fetch failed" }],
  ])(
    "returns the fallback for %s and records it after the response",
    async (_label, error) => {
      expect(mapCommandError(error, KNOWN, "things.save_failed", WHERE)).toBe(
        "things.save_failed"
      )
      expect(recordErrorEvent).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()

      await runAfter()
      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, WHERE)
    }
  )

  it("passes `where` through as given, with only a route", async () => {
    const error = { message: "things.backstop" }
    const where = { route: "action createThingAction" }

    mapCommandError(error, KNOWN, "things.save_failed", where)
    await runAfter()

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, where)
  })
})
