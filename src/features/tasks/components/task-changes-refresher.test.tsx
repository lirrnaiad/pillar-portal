// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TaskChangesRefresher } from "./task-changes-refresher"

const { refresh, createClient, state } = vi.hoisted(() => {
  const state = {
    setAuth: vi.fn(async () => {}),
    listeners: [] as { filter: unknown; callback: () => void }[],
    subscribeCallback: null as null | ((status: string) => void),
    channelCalls: [] as { topic: string; options: unknown }[],
    removeChannel: vi.fn<(channel: unknown) => Promise<string>>(
      async () => "ok"
    ),
    existing: [] as { topic: string }[],
  }
  const channel = {
    on: (_type: string, filter: unknown, callback: () => void) => {
      state.listeners.push({ filter, callback })
      return channel
    },
    subscribe: (callback: (status: string) => void) => {
      state.subscribeCallback = callback
      return channel
    },
  }
  return {
    refresh: vi.fn(),
    state,
    createClient: vi.fn(() => ({
      realtime: { setAuth: state.setAuth },
      channel: (topic: string, options: unknown) => {
        state.channelCalls.push({ topic, options })
        return channel
      },
      removeChannel: state.removeChannel,
      getChannels: () => state.existing,
    })),
  }
})

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/supabase/client", () => ({ createClient }))

async function mount() {
  const view = render(<TaskChangesRefresher />)
  // Let the awaited setAuth() settle so the channel is joined.
  await act(async () => {})
  return view
}

// document.hidden, as the browser reports it for this tab.
let hidden = false

beforeEach(() => {
  vi.useFakeTimers()
  state.listeners = []
  state.subscribeCallback = null
  state.channelCalls = []
  state.existing = []
  hidden = false
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("TaskChangesRefresher", () => {
  it("renders nothing", async () => {
    const { container } = await mount()

    expect(container).toBeEmptyDOMElement()
  })

  it("sets the auth token before joining the private task-changes channel", async () => {
    const order: string[] = []
    state.setAuth.mockImplementationOnce(async () => {
      order.push("setAuth")
    })
    createClient.mockImplementationOnce(() => ({
      realtime: { setAuth: state.setAuth },
      channel: (topic: string, options: unknown) => {
        order.push("channel")
        state.channelCalls.push({ topic, options })
        const channel = {
          on: () => channel,
          subscribe: () => channel,
        }
        return channel
      },
      removeChannel: state.removeChannel,
      getChannels: () => state.existing,
    }))

    await mount()

    expect(order).toEqual(["setAuth", "channel"])
    expect(state.channelCalls).toEqual([
      { topic: "task-changes", options: { config: { private: true } } },
    ])
  })

  it("listens for any change on tasks and task_assignments", async () => {
    await mount()

    expect(state.listeners.map((listener) => listener.filter)).toEqual([
      { event: "*", schema: "public", table: "tasks" },
      { event: "*", schema: "public", table: "task_assignments" },
    ])
  })

  it("refreshes once, 300ms after the last of a burst of events", async () => {
    await mount()

    state.listeners[0].callback()
    vi.advanceTimersByTime(200)
    state.listeners[1].callback()
    vi.advanceTimersByTime(299)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes within 2s even while events keep coming", async () => {
    await mount()

    // An event every 200ms from t=0: the 300ms debounce alone would never
    // fire, but the first event's 2s cap lands at t=2000.
    for (let now = 0; now < 1800; now += 200) {
      state.listeners[0].callback()
      vi.advanceTimersByTime(200)
    }
    state.listeners[0].callback()
    vi.advanceTimersByTime(199)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("holds a refresh while the tab is hidden, then refreshes once when shown", async () => {
    await mount()

    hidden = true
    state.listeners[0].callback()
    vi.advanceTimersByTime(300)
    state.listeners[1].callback()
    vi.advanceTimersByTime(300)
    expect(refresh).not.toHaveBeenCalled()

    setHidden(false)
    expect(refresh).toHaveBeenCalledTimes(1)

    setHidden(true)
    setHidden(false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("doesn't refresh on being shown when nothing changed", async () => {
    await mount()

    setHidden(true)
    setHidden(false)

    expect(refresh).not.toHaveBeenCalled()
  })

  it("removes a leftover channel with the same topic before joining", async () => {
    const leftover = { topic: "realtime:task-changes" }
    state.existing = [leftover]
    const order: string[] = []
    state.removeChannel.mockImplementationOnce(async () => {
      order.push("removeChannel")
      return "ok"
    })

    await mount()
    order.push(...state.channelCalls.map(() => "channel"))

    expect(state.removeChannel).toHaveBeenCalledWith(leftover)
    expect(order).toEqual(["removeChannel", "channel"])
  })

  it("ignores the event payload", async () => {
    await mount()

    ;(state.listeners[0].callback as (payload: unknown) => void)({
      new: { id: "secret" },
    })
    vi.advanceTimersByTime(300)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith()
  })

  it("refreshes when the channel re-subscribes after a drop, not on the first join", async () => {
    await mount()

    state.subscribeCallback?.("SUBSCRIBED")
    vi.advanceTimersByTime(300)
    expect(refresh).not.toHaveBeenCalled()

    state.subscribeCallback?.("CHANNEL_ERROR")
    vi.advanceTimersByTime(300)
    expect(refresh).not.toHaveBeenCalled()

    state.subscribeCallback?.("SUBSCRIBED")
    vi.advanceTimersByTime(300)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("removes the channel and cancels a pending refresh on unmount", async () => {
    const { unmount } = await mount()
    state.listeners[0].callback()

    unmount()
    vi.advanceTimersByTime(300)

    expect(state.removeChannel).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()

    setHidden(true)
    setHidden(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("never joins if it unmounts while the token is being set", async () => {
    let finish: () => void = () => {}
    state.setAuth.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const { unmount } = render(<TaskChangesRefresher />)

    unmount()
    finish()
    await act(async () => {})

    expect(state.channelCalls).toEqual([])
    expect(state.removeChannel).not.toHaveBeenCalled()
  })
})
