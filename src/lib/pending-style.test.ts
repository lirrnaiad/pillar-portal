import { describe, expect, it } from "vitest"

import { PENDING_STYLE } from "./pending-style"
import { cn } from "./utils"

describe("PENDING_STYLE", () => {
  it("dims the control and blocks the pointer only while it is aria-disabled", () => {
    expect(PENDING_STYLE.split(" ")).toEqual([
      "aria-disabled:cursor-not-allowed",
      "aria-disabled:opacity-50",
    ])
  })

  it("survives cn beside a control's own classes", () => {
    expect(cn("min-h-11 opacity-100", PENDING_STYLE)).toBe(
      `min-h-11 opacity-100 ${PENDING_STYLE}`
    )
  })
})
