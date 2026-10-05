import { describe, expect, it } from "vitest"

import {
  buildCalendarEvent,
  calendarRoutePath,
  googleCalendarUrl,
} from "./calendar"
import { buildIcs } from "./ics-file"

const TASK = {
  id: "00000000-0000-4000-8000-000000000021",
  title: "Lay out the spread",
  description: "a, b; c\nsecond line",
  dueAt: "2026-10-10T09:00:00+00:00",
  referenceUrl: "https://example.com/ref",
}
const SITE = "https://pillar.example"

describe("calendar builders", () => {
  it("titles, times and links the event", () => {
    const event = buildCalendarEvent(TASK, SITE)
    expect(event.title).toBe("Due: Lay out the spread")
    expect(event.start.toISOString()).toBe("2026-10-10T09:00:00.000Z")
    expect(event.end.toISOString()).toBe("2026-10-10T09:15:00.000Z")
    expect(event.details).toContain("a, b; c")
    expect(event.details).toContain("https://example.com/ref")
    expect(event.details).toContain(`${SITE}/dashboard/tasks/${TASK.id}`)
  })

  it("holds only the task link for a sparse task", () => {
    const event = buildCalendarEvent(
      { ...TASK, description: null, referenceUrl: null },
      SITE
    )
    expect(event.details).toBe(`Task: ${SITE}/dashboard/tasks/${TASK.id}`)
  })

  it("builds a Google URL with UTC dates and encoded values", () => {
    const url = googleCalendarUrl(buildCalendarEvent(TASK, SITE))
    expect(url).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Due%3A%20Lay%20out/
    )
    expect(url).toContain("dates=20261010T090000Z/20261010T091500Z")
    expect(url).toContain("a%2C%20b%3B%20c%0Asecond%20line")
  })

  it("writes a UTC event with two alarms and escaped text", () => {
    const ics = buildIcs(buildCalendarEvent(TASK, SITE))!
    expect(ics).toContain("DTSTART:20261010T090000Z")
    expect(ics).toContain("SUMMARY:Due: Lay out the spread")
    expect(ics).toContain("a\\, b\\; c\\nsecond line")
    expect(ics).toContain("UID:task-00000000-0000-4000-8000-000000000021")
    expect(ics).toMatch(/^TRIGGER:-P1D\r?$/m)
    expect(ics).toMatch(/^TRIGGER:-PT1H\r?$/m)
    expect(ics).not.toContain("-P1DT")
    expect((ics.match(/BEGIN:VALARM/g) ?? []).length).toBe(2)
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1)
  })

  it("caps the description in the Google URL only, keeping the links", () => {
    const long = "x".repeat(5000)
    const event = buildCalendarEvent({ ...TASK, description: long }, SITE)
    const url = googleCalendarUrl(event)
    expect(url.length).toBeLessThan(4000)
    expect(decodeURIComponent(url)).toContain(
      "…\n\nReference: https://example.com/ref"
    )
    expect(decodeURIComponent(url)).toContain(
      `Task: ${SITE}/dashboard/tasks/${TASK.id}`
    )
    expect(event.details).toContain(long)
    expect(buildIcs(event)).toContain("xxxxxxxxxx")
  })

  it("builds route paths", () => {
    expect(calendarRoutePath("x")).toBe("/api/tasks/x/ics")
    expect(calendarRoutePath("x", "google")).toBe("/api/tasks/x/ics?to=google")
  })
})
