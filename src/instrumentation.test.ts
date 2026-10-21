import { afterEach, describe, expect, it, vi } from "vitest"

const { recordErrorEvent } = vi.hoisted(() => ({
  recordErrorEvent: vi.fn(async () => {}),
}))

vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))

import { onRequestError } from "./instrumentation"

type Context = Parameters<typeof onRequestError>[2]

const CONTEXT: Context = {
  routerKind: "App Router",
  routePath: "/(member)/dashboard/tasks/[id]",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
}

// A request that records every property read, so a test can prove none is.
function watchedRequest() {
  const reads: PropertyKey[] = []
  const request = new Proxy(
    {
      path: "/dashboard/tasks/x?email=member@example.com",
      method: "GET",
      headers: { cookie: "sb-127-auth-token=secret" },
    },
    {
      get(target, key, receiver) {
        reads.push(key)
        return Reflect.get(target, key, receiver)
      },
      has(target, key) {
        reads.push(key)
        return Reflect.has(target, key)
      },
      ownKeys(target) {
        reads.push("ownKeys")
        return Reflect.ownKeys(target)
      },
    }
  )
  return { request, reads }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("onRequestError", () => {
  it("records the error with `<routeType> <routePath>`, never reading the request", async () => {
    const error = Object.assign(new Error("boom"), { digest: "123" })
    const { request, reads } = watchedRequest()

    await onRequestError(error, request, CONTEXT)

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
      route: "render /(member)/dashboard/tasks/[id]",
    })
    expect(reads).toEqual([])
  })

  it.each([
    ["action", "/(admin)/admin/members"],
    ["route", "/api/tasks/[id]/ics"],
  ] as const)(
    "names a %s error by its route type",
    async (routeType, routePath) => {
      const { request } = watchedRequest()

      await onRequestError(new Error("x"), request, {
        ...CONTEXT,
        routeType,
        routePath,
      })

      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        { route: `${routeType} ${routePath}` }
      )
    }
  )

  it("waits for the recording to finish", async () => {
    let finish: () => void = () => {}
    recordErrorEvent.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const { request } = watchedRequest()

    let settled = false
    const handling = Promise.resolve(
      onRequestError(new Error("x"), request, CONTEXT)
    ).then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    finish()
    await handling
    expect(settled).toBe(true)
  })

  it("never rejects, even when recording throws", async () => {
    recordErrorEvent.mockImplementationOnce(() => {
      throw new Error("recorder failed")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { request } = watchedRequest()

    await expect(
      onRequestError(new Error("x"), request, CONTEXT)
    ).resolves.toBeUndefined()
  })
})
