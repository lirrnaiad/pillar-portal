import { describe, expect, it } from "vitest"

import { formatInPht, phtInputToUtc } from "./time"

describe("phtInputToUtc", () => {
  it("converts a PHT wall-clock time to the UTC instant it names (UTC+8, no DST)", () => {
    expect(phtInputToUtc("2026-11-01T09:00").toISOString()).toBe(
      "2026-11-01T01:00:00.000Z"
    )
  })

  // The month/day boundary case: 11:30 PM PHT on Oct 31 is still Oct 31 in
  // Manila, eight hours ahead of UTC, so it must land at 3:30 PM UTC the same
  // day. A buggy conversion that builds `new Date(y, m, d, h, min)` in the
  // process's own default timezone first, then adjusts, can instead roll it
  // into November — this is exactly what TZDate exists to avoid.
  it("keeps 11:30 PM PHT on Oct 31 on Oct 31 in UTC, not rolled into November", () => {
    expect(phtInputToUtc("2026-10-31T23:30").toISOString()).toBe(
      "2026-10-31T15:30:00.000Z"
    )
  })

  it("accepts seconds when present", () => {
    expect(phtInputToUtc("2026-10-31T23:30:15").toISOString()).toBe(
      "2026-10-31T15:30:15.000Z"
    )
  })

  it.each(["", "not-a-date", "2026-10-31", "2026/10/31T23:30", "23:30"])(
    "throws on %j",
    (value) => {
      expect(() => phtInputToUtc(value)).toThrow(
        "phtInputToUtc: not a datetime-local value"
      )
    }
  )

  // The regex shape check alone would let these through and let Date's
  // constructor silently roll them over into a different, wrong instant
  // instead of rejecting them. Unreachable from the native datetime-local
  // input; only a caller that bypasses the form can produce them.
  it.each(["2026-13-01T09:00", "2026-02-30T09:00", "2026-11-01T25:00"])(
    "throws on the out-of-range calendar value %j instead of rolling it over",
    (value) => {
      expect(() => phtInputToUtc(value)).toThrow(
        "phtInputToUtc: not a real date/time"
      )
    }
  )
})

describe("formatInPht", () => {
  it("formats a UTC instant as Philippine wall-clock time", () => {
    expect(
      formatInPht("2026-10-31T15:30:00.000Z", "yyyy-MM-dd HH:mm")
    ).toBe("2026-10-31 23:30")
  })

  it("round-trips with phtInputToUtc across the month boundary", () => {
    const utc = phtInputToUtc("2026-10-31T23:30")
    expect(formatInPht(utc, "yyyy-MM-dd'T'HH:mm")).toBe("2026-10-31T23:30")
  })
})
