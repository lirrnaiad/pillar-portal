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
