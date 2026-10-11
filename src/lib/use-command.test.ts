// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { useOptimistic } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useCommand } from "./use-command"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { refresh, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

// resetAllMocks drops the mockImplementations some tests give toastError and
// refresh; restoreAllMocks undoes the navigator.onLine and console spies.
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

type Code = "thing.refused" | "thing.failed"
type Result = { ok: true; data: { id: string } } | { ok: false; code: Code }

const COPY: Record<Code, string> = {
  "thing.refused": "Refused copy",
  "thing.failed": "Failed copy",
}

function renderCommand() {
  return renderHook(() =>
    useCommand({
      errorMessage: (code: Code) => COPY[code],
      thrownCode: "thing.failed",
    })
  )
}

// useCommand as the command components use it: an optimistic value set
// inside the thunk, before the action's promise is returned.
function useOptimisticCommand(initial: string) {
  const { isPending, run } = useCommand({
    errorMessage: (code: Code) => COPY[code],
    thrownCode: "thing.failed",
  })
  const [shown, setShown] = useOptimistic(initial)
  return {
    isPending,
    shown,
    change(value: string, call: () => Promise<Result>) {
      run(() => {
        setShown(value)
        return call()
      })
    },
  }
}

describe("useCommand", () => {
  it("hands a success to onSuccess while still pending, with no toast or refresh", async () => {
    const { result } = renderCommand()
    const seen: { result: unknown; pending: boolean }[] = []
    const onFailure = vi.fn()

    act(() => {
      result.current.run(
        async (): Promise<Result> => ({ ok: true, data: { id: "t1" } }),
        {
          onSuccess: (success) =>
            seen.push({ result: success, pending: result.current.isPending }),
          onFailure,
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(seen).toEqual([
      { result: { ok: true, data: { id: "t1" } }, pending: true },
    ])
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("toasts a refused result's copy, re-reads the page, then calls onFailure", async () => {
    const { result } = renderCommand()
    const order: string[] = []
    toastError.mockImplementation(() => order.push("toast"))
    refresh.mockImplementation(() => order.push("refresh"))
    const onSuccess = vi.fn()

    act(() => {
      result.current.run(
        async (): Promise<Result> => ({ ok: false, code: "thing.refused" }),
        {
          onSuccess,
          onFailure: (code) => order.push(`onFailure:${code}`),
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Refused copy")
    expect(order).toEqual(["toast", "refresh", "onFailure:thing.refused"])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("treats a thrown call as the caller's thrown code", async () => {
    const { result } = renderCommand()
    const order: string[] = []
    toastError.mockImplementation(() => order.push("toast"))
    refresh.mockImplementation(() => order.push("refresh"))
    const onSuccess = vi.fn()

    act(() => {
      result.current.run(
        (): Promise<Result> => Promise.reject(new Error("network")),
        {
          onSuccess,
          onFailure: (code) => order.push(`onFailure:${code}`),
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Failed copy")
    expect(order).toEqual(["toast", "refresh", "onFailure:thing.failed"])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("skips the re-read while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const { result } = renderCommand()

    act(() => {
      result.current.run(async (): Promise<Result> => ({
        ok: false,
        code: "thing.refused",
      }))
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Refused copy")
    expect(refresh).not.toHaveBeenCalled()
  })

  // The reason run takes a thunk: React warns about an optimistic update made
  // outside a transition or action.
  it("runs the thunk inside the transition, so an optimistic value shows until the call settles", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { result } = renderHook(() => useOptimisticCommand("to_do"))
    let settle: (value: Result) => void = () => {}

    act(() => {
      result.current.change(
        "doing",
        () =>
          new Promise<Result>((resolve) => {
            settle = resolve
          })
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.shown).toBe("doing")

    await act(async () => settle({ ok: false, code: "thing.refused" }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.shown).toBe("to_do")
    expect(toastError).toHaveBeenCalledWith("Refused copy")

    const messages = consoleError.mock.calls.map((args) =>
      args.map(String).join(" ")
    )
    expect(
      messages.filter((message) => /outside a transition/.test(message))
    ).toEqual([])
  })

  it("ignores a run while one is pending, never calling its thunk", async () => {
    const { result } = renderCommand()
    let settle: (value: Result) => void = () => {}
    const first = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          settle = resolve
        })
    )
    const second = vi.fn(async (): Promise<Result> => ({
      ok: true,
      data: { id: "t2" },
    }))

    act(() => {
      result.current.run(first)
    })
    await waitFor(() => expect(result.current.isPending).toBe(true))

    act(() => {
      result.current.run(second)
    })
    expect(second).not.toHaveBeenCalled()

    await act(async () => settle({ ok: true, data: { id: "t1" } }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
})
