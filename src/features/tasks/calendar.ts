/** The event's length: a deadline marker, not a block of work. */
export const EVENT_MINUTES = 15

/** Description characters kept in the Google URL. */
const GOOGLE_DESCRIPTION_MAX = 1500

export type CalendarTask = {
  id: string
  title: string
  description: string | null
  dueAt: string
  referenceUrl: string | null
}

export type CalendarEvent = {
  uid: string
  /**
   * The details with the description cut for a URL: Google's prefilled link
   * (and a redirect's Location header) can't carry 5,000 characters.
   */
  googleDetails: string
  title: string
  start: Date
  end: Date
  details: string
}

/**
 * The one event both the file and the Google URL are built from. `siteUrl`
 * is `NEXT_PUBLIC_SITE_URL`, passed in so this module stays client-safe and
 * never reads a request's Host.
 */
export function buildCalendarEvent(
  task: CalendarTask,
  siteUrl: string
): CalendarEvent {
  const start = new Date(task.dueAt)
  const end = new Date(start.getTime() + EVENT_MINUTES * 60_000)
  const link = new URL(`/dashboard/tasks/${task.id}`, siteUrl).href

  const tail: string[] = []
  if (task.referenceUrl) tail.push(`Reference: ${task.referenceUrl}`)
  tail.push(`Task: ${link}`)
  const join = (description: string | null) =>
    [...(description ? [description] : []), ...tail].join("\n\n")

  return {
    uid: `task-${task.id}@pillar-portal`,
    title: `Due: ${task.title}`,
    start,
    end,
    details: join(task.description),
    googleDetails: join(
      task.description && task.description.length > GOOGLE_DESCRIPTION_MAX
        ? `${task.description.slice(0, GOOGLE_DESCRIPTION_MAX)}…`
        : task.description
    ),
  }
}

/** `YYYYMMDDTHHmmssZ`, in UTC. */
function googleDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    ["dates", `${googleDate(event.start)}/${googleDate(event.end)}`],
    ["details", event.googleDetails],
  ]
  // Hand-joined: URLSearchParams would write spaces as "+", and the dates'
  // slash must stay literal.
  const query = params
    .map(([key, value]) =>
      key === "dates"
        ? `${key}=${value}`
        : `${key}=${encodeURIComponent(value)}`
    )
    .join("&")
  return `https://calendar.google.com/calendar/render?${query}`
}

/** The one route: the file, or with "google" a redirect to Google. */
export function calendarRoutePath(id: string, to?: "google"): string {
  const base = `/api/tasks/${id}/ics`
  return to === "google" ? `${base}?to=google` : base
}
