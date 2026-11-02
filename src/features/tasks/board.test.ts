import { describe, expect, it } from "vitest"

import {
  boardDoneCutoff,
  boardEmptyMessage,
  ownerFilterParam,
  parseOwnerFilterParam,
  type OwnerFilter,
  type TaskOwnerOption,
} from "./board"

const OWNERS: TaskOwnerOption[] = [
  { kind: "section", id: "news", name: "News" },
  { kind: "section", id: "sports", name: "Sports" },
  { kind: "desk", id: "layout", name: "Layout" },
  { kind: "desk", id: "photo", name: "Photo" },
]

describe("ownerFilterParam", () => {
  it.each<[OwnerFilter, string]>([
    [{ kind: "all" }, "all"],
    [{ kind: "articles" }, "articles"],
    [{ kind: "section", id: "sports" }, "section:sports"],
    [{ kind: "desk", id: "photo" }, "desk:photo"],
  ])("writes %j as %s, and parses it back", (filter, param) => {
    expect(ownerFilterParam(filter)).toBe(param)
    expect(parseOwnerFilterParam(param, OWNERS)).toEqual(filter)
  })
})

describe("parseOwnerFilterParam", () => {
  it.each([
    ["a missing value", undefined],
    ["a repeated parameter", ["all", "articles"]],
    ["the Writers desk", "desk:writers"],
    ["an unknown word", "nope"],
    ["an unknown section", "section:nope"],
    ["an unknown desk", "desk:nope"],
    ["a desk id under section", "section:layout"],
    ["a section id under desk", "desk:news"],
    ["an unknown kind", "member:news"],
    ["an empty string", ""],
    ["a non-string", 3],
  ])("gives null for %s", (_label, value) => {
    expect(parseOwnerFilterParam(value, OWNERS)).toBeNull()
  })
})

describe("boardEmptyMessage", () => {
  it("names the section or desk", () => {
    expect(boardEmptyMessage({ kind: "section", id: "news" }, OWNERS)).toBe(
      "No tasks in News right now."
    )
    expect(boardEmptyMessage({ kind: "desk", id: "photo" }, OWNERS)).toBe(
      "No tasks in Photo right now."
    )
  })

  it("has its own copy for all articles", () => {
    expect(boardEmptyMessage({ kind: "articles" }, OWNERS)).toBe(
      "No tasks in any section right now."
    )
  })

  it("is null for All, whose columns show their own empty state", () => {
    expect(boardEmptyMessage({ kind: "all" }, OWNERS)).toBeNull()
  })
})

describe("boardDoneCutoff", () => {
  const NOW = new Date("2026-11-02T09:15:30.250Z")

  // The Board keeps a Done task when done_at >= the cutoff (PostgREST's gte).
  const onBoard = (doneAt: string) =>
    new Date(doneAt).getTime() >= new Date(boardDoneCutoff(NOW)).getTime()

  it("is now minus exactly 30 × 24 hours, as ISO", () => {
    expect(boardDoneCutoff(NOW)).toBe("2026-10-03T09:15:30.250Z")
  })

  it("keeps a task done exactly 30 days ago: the edge is inclusive", () => {
    expect(onBoard("2026-10-03T09:15:30.250Z")).toBe(true)
  })

  it("drops a task done 30 days and 1 second ago", () => {
    expect(onBoard("2026-10-03T09:15:29.250Z")).toBe(false)
  })

  it("counts hours, not calendar days, so a time zone never moves it", () => {
    expect(
      new Date(NOW).getTime() - new Date(boardDoneCutoff(NOW)).getTime()
    ).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
