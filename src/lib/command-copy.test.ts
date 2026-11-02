import { describe, expect, it } from "vitest"

import { STALE_COPY } from "./command-copy"

describe("STALE_COPY", () => {
  it("is EXPERIENCE.md's stale line, verbatim", () => {
    expect(STALE_COPY).toBe(
      "Something changed since you opened this. Review the latest and try again."
    )
  })
})
