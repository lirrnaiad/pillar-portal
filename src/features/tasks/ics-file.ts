import { createEvent } from "ics"

import { EVENT_MINUTES, type CalendarEvent } from "./calendar"

// Apart from calendar.ts so the menus (client code) don't ship the ics
// library: only the route needs the file. The barrel re-exports `buildIcs`,
// but the client chunks tree-shake it out: after `pnpm build`,
// `grep -r VCALENDAR .next/static` finds nothing (re-check if this changes).

function utcParts(date: Date): [number, number, number, number, number] {
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ]
}

/** The .ics text for the event, or null if the library refuses it. */
export function buildIcs(event: CalendarEvent): string | null {
  const { error, value } = createEvent({
    uid: event.uid,
    title: event.title,
    description: event.details,
    start: utcParts(event.start),
    startInputType: "utc",
    startOutputType: "utc",
    duration: { minutes: EVENT_MINUTES },
    productId: "pillar-portal",
    alarms: [
      {
        action: "display",
        description: "Due in 1 day",
        trigger: { days: 1, before: true },
      },
      {
        action: "display",
        description: "Due in 1 hour",
        trigger: { hours: 1, before: true },
      },
    ],
  })
  if (error || !value) return null
  // ics writes a one-day trigger as "-P1DT"; a bare "-P1D" is the clean form.
  return value.replace(/^(TRIGGER:-P\d+D)T\r?$/gm, (m) =>
    m.replace(/T(\r?)$/, "$1")
  )
}
