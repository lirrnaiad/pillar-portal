import { TZDate } from "@date-fns/tz"
import { format } from "date-fns"

// The only timezone the portal's members are in (epic-1-context.md › Time,
// cache, Realtime). Every PHT-entry <-> UTC-storage conversion goes through
// this module; nothing else names a timezone.
export const PHT_TIME_ZONE = "Asia/Manila"

// Exported so taskCreateSchema can validate the shape without duplicating it.
export const DATETIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Converts an `<input type="datetime-local">` value, entered as a Philippine
 * wall-clock time, to the UTC instant it names. PHT has no daylight saving
 * (a fixed UTC+8), but the conversion still goes through `TZDate` rather than
 * subtracting eight hours by hand: that would silently depend on the
 * process's own default timezone if it were built from `new Date(y, m, d, ...)`
 * first, which is exactly the bug this function exists to avoid.
 *
 * Throws on a value that isn't `YYYY-MM-DDTHH:mm` (optionally `:ss`), which
 * `taskCreateSchema` is expected to have already rejected, or whose
 * components aren't a real calendar date/time (e.g. month 13, day 32):
 * `Date`'s constructor rolls those over into a different, silently-wrong
 * instant instead of rejecting them, so the round trip below catches what the
 * regex shape check can't. A native `datetime-local` input can't produce
 * either case, so this only matters for a caller that bypasses the form.
 */
export function phtInputToUtc(value: string): Date {
  const match = DATETIME_LOCAL_PATTERN.exec(value)
  if (!match) {
    throw new Error(`phtInputToUtc: not a datetime-local value: ${value}`)
  }
  const [, year, month, day, hour, minute, second] = match
  const [y, mo, d, h, mi, s] = [year, month, day, hour, minute, second].map(
    (part) => Number(part ?? 0)
  )
  const zoned = new TZDate(y, mo - 1, d, h, mi, s, PHT_TIME_ZONE)
  if (
    zoned.getFullYear() !== y ||
    zoned.getMonth() !== mo - 1 ||
    zoned.getDate() !== d ||
    zoned.getHours() !== h ||
    zoned.getMinutes() !== mi ||
    zoned.getSeconds() !== s
  ) {
    throw new Error(`phtInputToUtc: not a real date/time: ${value}`)
  }
  return new Date(zoned.getTime())
}

/**
 * Formats a UTC instant (a `Date`, or anything `Date` accepts) as Philippine
 * wall-clock time, with a date-fns format string (e.g. `"MMM d, yyyy h:mm a"`).
 */
export function formatInPht(
  date: Date | string | number,
  formatStr: string
): string {
  const instant = date instanceof Date ? date : new Date(date)
  return format(new TZDate(instant.getTime(), PHT_TIME_ZONE), formatStr)
}

// The Planner's calendar math. A month is `YYYY-MM` and a day `YYYY-MM-DD`,
// both Manila calendar dates. Nothing is built with `new Date(y, m, d)` (the
// process's own timezone), so the answers are the same on a server in UTC, a
// laptop in Manila or a CI box anywhere. Instants (a month's bounds, the day
// a due time falls on) go through TZDate in Manila; the grid's weekdays, its
// days in a month and the labels are plain calendar arithmetic, done on a
// UTC calendar date (`calendarDate`), because Manila's own history isn't a
// clean calendar: it skipped Dec 31, 1844 when it moved across the date line.

const MONTH_PATTERN = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/
const DAY_KEY_PATTERN = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * The month a `month` search parameter names (`YYYY-MM`, year 1000–9999,
 * month 01–12), or null for anything else: a missing value, `2026-13`,
 * `2026-1`, and a repeated parameter (an array).
 */
export function parsePhtMonth(value: unknown): string | null {
  return typeof value === "string" && MONTH_PATTERN.test(value) ? value : null
}

function monthParts(month: string): [year: number, month: number] {
  const match = MONTH_PATTERN.exec(month)
  if (!match) throw new Error(`not a YYYY-MM month: ${month}`)
  return [Number(match[1]), Number(match[2])]
}

/**
 * A calendar date as midnight UTC, read back through UTC getters, so its
 * weekday and day of the month never depend on any timezone's history.
 */
function calendarDate(year: number, month: number, day: number): TZDate {
  return new TZDate(Date.UTC(year, month - 1, day), "UTC")
}

/** Throws on a value that isn't `YYYY-MM-DD`, or isn't a real day (Feb 30). */
function dayParts(dayKey: string): [year: number, month: number, day: number] {
  const match = DAY_KEY_PATTERN.exec(dayKey)
  if (!match) throw new Error(`not a YYYY-MM-DD day: ${dayKey}`)
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // Date.UTC rolls Feb 30 over into March instead of refusing it.
  if (calendarDate(y, m, d).getDate() !== d) {
    throw new Error(`not a real day: ${dayKey}`)
  }
  return [y, m, d]
}

/** The Manila month (`YYYY-MM`) an instant falls in. */
export function phtMonthOf(date: Date | string | number): string {
  return formatInPht(date, "yyyy-MM")
}

/** The Manila calendar date (`YYYY-MM-DD`) an instant falls on. */
export function phtDayKey(date: Date | string | number): string {
  return formatInPht(date, "yyyy-MM-dd")
}

/**
 * The month as UTC instants: from Manila midnight on the 1st (`start`,
 * inclusive) up to Manila midnight on the next month's 1st (`end`,
 * exclusive). `2026-10` is 2026-09-30T16:00Z up to 2026-10-31T16:00Z.
 */
export function phtMonthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = monthParts(month)
  // Month index `m` is the next month (December's rolls into January).
  return {
    start: new Date(new TZDate(y, m - 1, 1, 0, 0, 0, PHT_TIME_ZONE).getTime()),
    end: new Date(new TZDate(y, m, 1, 0, 0, 0, PHT_TIME_ZONE).getTime()),
  }
}

/** The month `delta` months after `month` (before it when negative). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = monthParts(month)
  const index = y * 12 + (m - 1) + delta
  const year = Math.floor(index / 12)
  const monthIndex = index - year * 12
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`
}

/**
 * The month's weeks, Sunday first: each a row of seven day keys, with `null`
 * for the days before the 1st and after the last day.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = monthParts(month)
  const leading = calendarDate(y, m, 1).getDay()
  // Day 0 of the next month is this month's last day.
  const days = calendarDate(y, m + 1, 0).getDate()

  const cells: (string | null)[] = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= days; day++) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** "October 2026". */
export function phtMonthLabel(month: string): string {
  const [y, m] = monthParts(month)
  return format(calendarDate(y, m, 1), "MMMM yyyy")
}

/** "Thu, Oct 8", for a `YYYY-MM-DD` day key. */
export function phtDayLabel(dayKey: string): string {
  const [y, m, d] = dayParts(dayKey)
  return format(calendarDate(y, m, d), "EEE, MMM d")
}
