import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { abortSignal, createAdminClient, rpc } = vi.hoisted(() => {
  const abortSignal = vi.fn()
  const rpc = vi.fn(() => ({ abortSignal }))
  return { abortSignal, createAdminClient: vi.fn(() => ({ rpc })), rpc }
})

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }))

import {
  errorCodeOf,
  errorEventOf,
  recordErrorEvent,
} from "./record-error-event"

const TASK_ID = "00000000-0000-4000-8000-000000000021"

// A database error carrying everything a row must never hold.
function hostilePostgrestError() {
  return {
    name: "PostgrestError",
    code: "42501",
    message: "permission denied for user member@example.com",
    details: 'Failing row contains (member@example.com, "Ana Cruz")',
    hint: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
    stack: 'Error: at handler (body={"reason":"Exams"})',
    cause: {
      code: "member@example.com",
      message: "member@example.com",
      details: "Ana Cruz",
    },
    headers: { cookie: "sb-127-auth-token=secret" },
    body: { email: "member@example.com" },
  }
}

beforeEach(() => {
  abortSignal.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("errorEventOf", () => {
  it("keeps the code, the route, the entity and nothing else of a hostile error", () => {
    const event = errorEventOf(hostilePostgrestError(), {
      route: "action moveTaskAction",
      entityType: "task",
      entityId: TASK_ID,
    })

    expect(event).toEqual({
      code: "42501",
      route: "action moveTaskAction",
      entity_type: "task",
      entity_id: TASK_ID,
    })
    const serialized = JSON.stringify(event)
    for (const fragment of ["@", "member", "Ana", "eyJ", "cookie", "Exams"]) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it.each([
    ["a SQLSTATE", { code: "23514", message: "x" }, "23514"],
    ["a PostgREST code", { code: "PGRST301", message: "x" }, "PGRST301"],
    [
      "an Auth code",
      { code: "flow_state_not_found", name: "AuthApiError" },
      "flow_state_not_found",
    ],
    [
      "a name when there is no code",
      new TypeError("fetch failed"),
      "TypeError",
    ],
    [
      "a name when the code is empty",
      { code: "", name: "PostgrestError" },
      "PostgrestError",
    ],
    [
      "a name when the code is a number",
      { code: 23, name: "TimeoutError" },
      "TimeoutError",
    ],
    [
      "a name when the code holds an email",
      { code: "member@example.com", name: "AuthError" },
      "AuthError",
    ],
    [
      "unknown when neither fits",
      { code: "has a space", name: "has a space" },
      "unknown",
    ],
    [
      "unknown for a code over 64 characters",
      { code: "a".repeat(65) },
      "unknown",
    ],
    ["unknown for a thrown string", "member@example.com", "unknown"],
    ["unknown for null", null, "unknown"],
  ])("takes %s", (_label, error, code) => {
    expect(errorEventOf(error, { route: "render /" }).code).toBe(code)
  })

  it("survives a property getter that throws", () => {
    const error = Object.defineProperty({}, "code", {
      get() {
        throw new Error("boom")
      },
    })
    expect(errorCodeOf(error)).toBe("unknown")
  })

  describe("a wrapped error's cause", () => {
    // How the slice queries throw: their own Error, the PostgREST error as
    // its cause.
    const wrapped = (cause: unknown) =>
      new Error("getBoard: tasks query failed", { cause })

    it("yields its cause's code when the error has none", () => {
      const error = wrapped({
        code: "PGRST301",
        message: "JWT expired",
        details: null,
        hint: null,
      })
      expect(errorEventOf(error, { route: "render /dashboard" })).toEqual({
        code: "PGRST301",
        route: "render /dashboard",
      })
    })

    it("contributes nothing but a fitting code, however hostile it is", () => {
      const error = wrapped({
        code: "42501",
        message: "permission denied for member@example.com",
        details: 'Failing row contains (member@example.com, "Ana Cruz")',
        hint: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
        email: "member@example.com",
      })

      const event = errorEventOf(error, { route: "render /dashboard" })

      expect(event).toEqual({ code: "42501", route: "render /dashboard" })
      const serialized = JSON.stringify(event)
      for (const fragment of ["@", "member", "Ana", "eyJ", "permission"]) {
        expect(serialized).not.toContain(fragment)
      }
    })

    it.each([
      ["a code that doesn't fit", { code: "member@example.com" }],
      ["no code", { message: "member@example.com" }],
      ["a string", "member@example.com"],
      [
        "a code only two levels down",
        new Error("y", { cause: { code: "42501" } }),
      ],
    ])(
      "falls back to the error's name for a cause with %s",
      (_label, cause) => {
        expect(errorCodeOf(wrapped(cause))).toBe("Error")
      }
    )

    it("prefers the error's own code", () => {
      const error = Object.assign(wrapped({ code: "PGRST301" }), {
        code: "23514",
      })
      expect(errorCodeOf(error)).toBe("23514")
    })

    it("survives a cause, or a cause's code, whose getter throws", () => {
      const throwing = (key: string) =>
        Object.defineProperty({}, key, {
          get() {
            throw new Error("boom")
          },
        })
      const causeThrows = Object.assign(throwing("cause"), { name: "Error" })

      expect(errorCodeOf(causeThrows)).toBe("Error")
      expect(errorCodeOf(wrapped(throwing("code")))).toBe("Error")
    })
  })

  it.each([
    [
      "cuts the route at the first ?",
      "route /auth/callback?code=abc&next=/x",
      "route /auth/callback",
    ],
    [
      "caps the route at 200 characters",
      `render /${"a".repeat(300)}`,
      `render /${"a".repeat(192)}`,
    ],
    [
      "falls back to unknown for an empty route",
      "?email=member@example.com",
      "unknown",
    ],
  ])("%s", (_label, route, expected) => {
    expect(errorEventOf(new Error("x"), { route }).route).toBe(expected)
  })

  it.each([
    [
      "a non-uuid id",
      { entityType: "task", entityId: "member@example.com" },
      { entity_type: "task" },
    ],
    ["an id without a type", { entityId: TASK_ID }, {}],
    [
      "a type that isn't a slug",
      { entityType: "Task Row", entityId: TASK_ID },
      {},
    ],
  ])("drops %s", (_label, entity, kept) => {
    const event = errorEventOf(new Error("x"), { route: "action x", ...entity })
    expect(event).toEqual({ code: "Error", route: "action x", ...kept })
  })

  it.each([
    ["React's", "2349823498"],
    ["Next's own, `<hash>@E<n>`", "123456@E394"],
  ])("keeps %s digest", (_label, digest) => {
    const rendered = Object.assign(new Error("x"), { digest })
    expect(errorEventOf(rendered, { route: "render /dashboard" })).toEqual({
      code: "Error",
      route: "render /dashboard",
      digest,
    })
  })

  it.each([
    ["an email", "member@example.com"],
    ["a space", "123 456"],
    ["a dot", "123.456"],
    ["over 64 characters", "a".repeat(65)],
  ])("drops a digest with %s", (_label, digest) => {
    const hostile = Object.assign(new Error("x"), { digest })
    expect(errorEventOf(hostile, { route: "render /" })).not.toHaveProperty(
      "digest"
    )
  })
})

describe("recordErrorEvent", () => {
  it("calls record_error_event with exactly the row's fields and a 3-second limit", async () => {
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal)

    await recordErrorEvent(hostilePostgrestError(), {
      route: "action respondToSlotAction",
      entityType: "task_assignment",
      entityId: TASK_ID,
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_error_event", {
      code: "42501",
      route: "action respondToSlotAction",
      entity_type: "task_assignment",
      entity_id: TASK_ID,
    })
    expect(timeout).toHaveBeenCalledExactlyOnceWith(3000)
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it("logs nothing when the row is written", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await recordErrorEvent(new Error("x"), { route: "render /" })

    expect(errorLog).not.toHaveBeenCalled()
  })

  it("swallows a returned error, logging its code only", async () => {
    abortSignal.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function for member@example.com",
        details: "member@example.com",
      },
    })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      recordErrorEvent(new Error("x"), { route: "render /" })
    ).resolves.toBeUndefined()

    expect(errorLog).toHaveBeenCalledExactlyOnceWith(
      "recordErrorEvent: record_error_event failed",
      "PGRST202"
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("@")
  })

  it("swallows a throw, logging its code only", async () => {
    abortSignal.mockRejectedValue(
      Object.assign(new TypeError("fetch failed for member@example.com"), {
        code: "ECONNREFUSED",
      })
    )
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      recordErrorEvent(new Error("x"), { route: "render /" })
    ).resolves.toBeUndefined()

    expect(errorLog).toHaveBeenCalledExactlyOnceWith(
      "recordErrorEvent: record_error_event threw",
      "ECONNREFUSED"
    )
  })

  it("swallows a client that can't be created (a missing key)", async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("Invalid server environment variables")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      recordErrorEvent(new Error("x"), { route: "render /" })
    ).resolves.toBeUndefined()
  })

  it("gives up when the write times out", async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    // Like postgrest-js, the call settles with an error once its signal
    // aborts, and never before.
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
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    const recording = recordErrorEvent(new Error("x"), { route: "render /" })
    controller.abort()

    await expect(recording).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalledExactlyOnceWith(
      "recordErrorEvent: record_error_event failed",
      "20"
    )
  })
})
