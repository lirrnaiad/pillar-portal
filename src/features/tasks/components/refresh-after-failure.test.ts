// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { refreshAfterFailure } from "./refresh-after-failure"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("refreshAfterFailure", () => {
  it("re-reads the page when online", () => {
    const router = { refresh: vi.fn() }
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)

    refreshAfterFailure(router)

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  // Offline, the re-read would fail and Next.js would fall back to a full
  // browser navigation: the browser's offline page.
  it("skips the re-read when offline", () => {
    const router = { refresh: vi.fn() }
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)

    refreshAfterFailure(router)

    expect(router.refresh).not.toHaveBeenCalled()
  })
})
