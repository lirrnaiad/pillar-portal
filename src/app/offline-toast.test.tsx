// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast }))

import { OfflineToast } from "./offline-toast"

const COPY = "You're offline. Changes won't save until you reconnect."

function fire(type: "offline" | "online") {
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("OfflineToast", () => {
  it("toasts the offline line, with its id and sonner's default duration, when the connection drops", () => {
    render(<OfflineToast />)

    fire("offline")

    expect(toast).toHaveBeenCalledExactlyOnceWith(COPY, { id: "offline" })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts once for a repeated offline event", () => {
    render(<OfflineToast />)

    fire("offline")
    fire("offline")

    expect(toast).toHaveBeenCalledOnce()
  })

  it("toasts again for a drop after the connection came back", () => {
    render(<OfflineToast />)

    fire("offline")
    fire("online")
    fire("offline")

    expect(toast).toHaveBeenCalledTimes(2)
    expect(toast).toHaveBeenNthCalledWith(2, COPY, { id: "offline" })
  })

  it("doesn't toast on mount, even when the page opens offline, or when the connection comes back", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)

    render(<OfflineToast />)
    fire("online")

    expect(toast).not.toHaveBeenCalled()
  })

  it("toasts once per drop under StrictMode, whose second effect run replaces the first's listeners", () => {
    render(
      <StrictMode>
        <OfflineToast />
      </StrictMode>
    )

    fire("offline")
    fire("offline")

    expect(toast).toHaveBeenCalledOnce()
  })

  it("removes both listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener")
    const { unmount } = render(<OfflineToast />)

    unmount()
    fire("offline")

    expect(toast).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith("offline", expect.any(Function))
    expect(remove).toHaveBeenCalledWith("online", expect.any(Function))
  })

  it("renders nothing", () => {
    const { container } = render(<OfflineToast />)

    expect(container).toBeEmptyDOMElement()
  })
})
