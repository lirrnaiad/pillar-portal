import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  formatInPht,
  monthWeeks,
  parsePhtMonth,
  phtDayKey,
  phtDayLabel,
  phtInputToUtc,
  phtMonthBounds,
  phtMonthLabel,
  phtMonthOf,
  shiftMonth,
} from "./time"

// Every test here must pass whatever the process's own timezone is, so every
// suite runs once per zone below: Manila itself, UTC (the servers), a zone
// behind UTC and one fourteen hours ahead. Node re-reads TZ whenever
// `process.env.TZ` changes, which `vi.stubEnv` does; each zone's first test
// checks that the switch really happens, so these runs can't pass vacuously.
const ZONES = [
  ["Asia/Manila", -480],
  ["UTC", 0],
  ["America/Los_Angeles", 480],
  ["Pacific/Kiritimati", -840],
] as const

describe.each(ZONES)("with TZ=%s", (zone, januaryOffset) => {
  // Before each test, not once: vitest.config.ts's `unstubEnvs` undoes every
  // stub before each test.
  beforeEach(() => {
    vi.stubEnv("TZ", zone)
  })

  it("runs in that zone", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(januaryOffset)
  })

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
      expect(formatInPht("2026-10-31T15:30:00.000Z", "yyyy-MM-dd HH:mm")).toBe(
        "2026-10-31 23:30"
      )
    })

    it("round-trips with phtInputToUtc across the month boundary", () => {
      const utc = phtInputToUtc("2026-10-31T23:30")
      expect(formatInPht(utc, "yyyy-MM-dd'T'HH:mm")).toBe("2026-10-31T23:30")
    })
  })

  describe("parsePhtMonth", () => {
    it.each(["2026-10", "2026-01", "2026-12", "1000-01", "9999-12"])(
      "accepts %j",
      (value) => {
        expect(parsePhtMonth(value)).toBe(value)
      }
    )

    it.each([
      ["month 13", "2026-13"],
      ["month 00", "2026-00"],
      ["not a month", "abc"],
      ["a one-digit month", "2026-1"],
      ["a day", "2026-10-08"],
      ["a three-digit year", "999-12"],
      ["year 0999", "0999-12"],
      ["a five-digit year", "10000-01"],
      ["surrounding space", " 2026-10"],
      ["empty", ""],
      ["missing", undefined],
      ["null", null],
      ["a number", 202610],
      ["repeated", ["2026-10", "2026-11"]],
    ])("refuses %s", (_label, value) => {
      expect(parsePhtMonth(value)).toBeNull()
    })
  })

  describe("phtMonthOf and phtDayKey", () => {
    // 16:30Z on Oct 31 is already 00:30 on Nov 1 in Manila.
    it("puts 2026-10-31T16:30Z in November, on Nov 1", () => {
      expect(phtMonthOf(new Date("2026-10-31T16:30:00Z"))).toBe("2026-11")
      expect(phtDayKey("2026-10-31T16:30:00Z")).toBe("2026-11-01")
    })

    it("keeps 2026-10-31T15:30Z (11:30 PM PHT) in October, on Oct 31", () => {
      expect(phtMonthOf("2026-10-31T15:30:00Z")).toBe("2026-10")
      expect(phtDayKey(new Date("2026-10-31T15:30:00Z"))).toBe("2026-10-31")
    })

    it("puts Manila midnight on the 1st on the 1st", () => {
      expect(phtDayKey("2026-09-30T16:00:00Z")).toBe("2026-10-01")
      expect(phtDayKey("2026-09-30T15:59:59.999Z")).toBe("2026-09-30")
    })
  })

  describe("phtMonthBounds", () => {
    const iso = (bounds: { start: Date; end: Date }) => ({
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
    })

    it("runs from Manila midnight on the 1st up to Manila midnight on the next 1st", () => {
      expect(iso(phtMonthBounds("2026-10"))).toEqual({
        start: "2026-09-30T16:00:00.000Z",
        end: "2026-10-31T16:00:00.000Z",
      })
    })

    it("holds 15:30Z on Oct 31 in October and 16:30Z in November only", () => {
      const october = phtMonthBounds("2026-10")
      const november = phtMonthBounds("2026-11")
      const inside = (instant: string, bounds: { start: Date; end: Date }) => {
        const t = new Date(instant).getTime()
        return t >= bounds.start.getTime() && t < bounds.end.getTime()
      }

      expect(inside("2026-10-31T15:30:00Z", october)).toBe(true)
      expect(inside("2026-10-31T15:30:00Z", november)).toBe(false)
      expect(inside("2026-10-31T16:30:00Z", october)).toBe(false)
      expect(inside("2026-10-31T16:30:00Z", november)).toBe(true)
      // The end is exclusive: the next month's start belongs to the next month.
      expect(october.end.getTime()).toBe(november.start.getTime())
    })

    it("rolls December into the next year's January", () => {
      expect(iso(phtMonthBounds("2026-12"))).toEqual({
        start: "2026-11-30T16:00:00.000Z",
        end: "2026-12-31T16:00:00.000Z",
      })
    })

    it("covers February 2028's 29 days", () => {
      expect(iso(phtMonthBounds("2028-02"))).toEqual({
        start: "2028-01-31T16:00:00.000Z",
        end: "2028-02-29T16:00:00.000Z",
      })
    })

    it("throws on a value that isn't a month", () => {
      expect(() => phtMonthBounds("2026-13")).toThrow("not a YYYY-MM month")
    })
  })

  describe("shiftMonth", () => {
    it.each([
      ["2026-10", 1, "2026-11"],
      ["2026-10", -1, "2026-09"],
      ["2026-01", -1, "2025-12"],
      ["2026-12", 1, "2027-01"],
      ["2026-10", 0, "2026-10"],
      ["2026-10", 15, "2028-01"],
      ["2026-10", -22, "2024-12"],
    ])("moves %s by %i to %s", (month, delta, expected) => {
      expect(shiftMonth(month, delta)).toBe(expected)
    })
  })

  describe("monthWeeks", () => {
    it("lays October 2026 out Sunday first, padded with null (Oct 1 is a Thursday)", () => {
      const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`
      const range = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, i) => day(from + i))

      expect(monthWeeks("2026-10")).toEqual([
        [null, null, null, null, ...range(1, 3)],
        range(4, 10),
        range(11, 17),
        range(18, 24),
        range(25, 31),
      ])
    })

    it("lays February 2028 out with its leap day (Feb 1 is a Tuesday)", () => {
      const day = (d: number) => `2028-02-${String(d).padStart(2, "0")}`
      const range = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, i) => day(from + i))

      expect(monthWeeks("2028-02")).toEqual([
        [null, null, ...range(1, 5)],
        range(6, 12),
        range(13, 19),
        range(20, 26),
        [...range(27, 29), null, null, null, null],
      ])
    })

    it("gives a month starting on Sunday no leading padding (November 2026)", () => {
      const weeks = monthWeeks("2026-11")
      expect(weeks[0][0]).toBe("2026-11-01")
      expect(weeks.at(-1)).toEqual([
        "2026-11-29",
        "2026-11-30",
        null,
        null,
        null,
        null,
        null,
      ])
    })

    it("ends December on the 31st", () => {
      const days = monthWeeks("2026-12").flat().filter(Boolean)
      expect(days).toHaveLength(31)
      expect(days.at(-1)).toBe("2026-12-31")
    })

    // Manila skipped Dec 31, 1844 (it crossed the date line), which a grid
    // built from Manila dates would turn into a one-day December.
    it("is plain calendar arithmetic, whatever Manila's history (December 1844)", () => {
      const weeks = monthWeeks("1844-12")
      const days = weeks.flat().filter(Boolean)
      expect(days).toHaveLength(31)
      // Dec 1, 1844 was a Sunday.
      expect(weeks[0][0]).toBe("1844-12-01")
      expect(days.at(-1)).toBe("1844-12-31")
    })
  })

  describe("phtMonthLabel and phtDayLabel", () => {
    it("names the month", () => {
      expect(phtMonthLabel("2026-10")).toBe("October 2026")
      expect(phtMonthLabel("2028-02")).toBe("February 2028")
    })

    it("names the day", () => {
      expect(phtDayLabel("2026-10-08")).toBe("Thu, Oct 8")
      expect(phtDayLabel("2028-02-29")).toBe("Tue, Feb 29")
    })

    it("throws on a value that isn't a day key", () => {
      expect(() => phtDayLabel("2026-10-32")).toThrow("not a YYYY-MM-DD day")
    })

    it.each(["2026-02-29", "2026-02-30", "2026-02-31", "2026-04-31"])(
      "throws on %s, a day that doesn't exist, rather than rolling it over",
      (dayKey) => {
        expect(() => phtDayLabel(dayKey)).toThrow("not a real day")
      }
    )

    it("names a day Manila skipped, as the calendar date it is", () => {
      expect(phtDayLabel("1844-12-31")).toBe("Tue, Dec 31")
    })
  })
})
