import { describe, expect, it } from "vitest"

import { initialsOf } from "./initials"

describe("initialsOf", () => {
  it.each([
    ["one word", "Editor", "E"],
    ["two words", "Staff Writer", "SW"],
    ["the first and last of three words", "Head Layout Artist", "HA"],
    ["hyphenated words", "Editor-in-Chief", "EC"],
    ["lowercase words", "maria clara", "MC"],
    ["surrounding whitespace", "  Staff \t Writer \n", "SW"],
    ["a name starting with an emoji", "🦊 Fox", "🦊F"],
    ["a word that is only an emoji", "Kit 🦊", "K🦊"],
    ["a name with no letters", "   ", "?"],
  ])("handles %s", (_label, name, initials) => {
    expect(initialsOf(name)).toBe(initials)
  })

  it("never splits a surrogate pair", () => {
    const initials = initialsOf("🦊 Fox")
    expect(initials.isWellFormed()).toBe(true)
    expect(Array.from(initials)).toEqual(["🦊", "F"])
  })
})
