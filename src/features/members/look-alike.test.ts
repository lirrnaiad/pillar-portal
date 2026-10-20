import { describe, expect, it } from "vitest"

import {
  findLookAlike,
  normalizedEmailLocal,
  normalizedName,
} from "./look-alike"

const ACTIVE = [
  { id: "a", name: "María José Dela Cruz", email: "mj.delacruz@gmail.com" },
  { id: "b", name: "Juan O'Neil-Santos", email: "juan.santos@up.edu.ph" },
  { id: "c", name: "Staff Writer", email: "demo-staff_writer@example.com" },
]

describe("normalizedName", () => {
  it.each([
    ["María José", "mariajose"],
    ["  JUAN   dela   Cruz ", "juandelacruz"],
    ["O'Neil-Santos, Jr.", "oneilsantosjr"],
    ["Ñoño\tÇedilla\nÅström", "nonocedillaastrom"],
    ["ｆｕｌｌ ｗｉｄｔｈ", "fullwidth"],
    ["Star ★ Name", "starname"],
    ["Juan Cruz III 2", "juancruziii2"],
    ["...", ""],
    ["", ""],
  ])("%j → %j", (name, expected) => {
    expect(normalizedName(name)).toBe(expected)
  })
})

describe("normalizedEmailLocal", () => {
  it.each([
    ["Mj.DelaCruz@Gmail.com", "mjdelacruz"],
    ["m.j.dela.cruz+pillar@gmail.com", "mjdelacruz"],
    ["juan+one+two@example.com", "juan"],
    ["+tag@example.com", ""],
    ["no-at-sign", "no-at-sign"],
    ["", ""],
  ])("%j → %j", (email, expected) => {
    expect(normalizedEmailLocal(email)).toBe(expected)
  })
})

describe("findLookAlike", () => {
  it("matches a name that differs only in accents, case, punctuation and spacing", () => {
    expect(
      findLookAlike(
        { name: "maria  jose DELA-cruz", email: "someone@else.com" },
        ACTIVE
      )
    ).toBe(ACTIVE[0])
  })

  it.each([
    ["O'Neil", "ONeil"],
    ["Dela Cruz", "Delacruz"],
    ["De la Cruz", "Delacruz"],
    ["De la Cruz", "Dela Cruz"],
    ["Mary-Ann Santos", "Maryann Santos"],
  ])(
    "matches %j with %j: punctuation and spacing don't count",
    (pending, active) => {
      const members = [{ name: active, email: "active@example.com" }]
      expect(
        findLookAlike({ name: pending, email: "pending@example.com" }, members)
      ).toBe(members[0])
    }
  )

  it("matches an email local part that differs only in case, dots and a +tag", () => {
    expect(
      findLookAlike(
        { name: "Juan S.", email: "Juan.Santos+pillar@gmail.com" },
        ACTIVE
      )
    ).toBe(ACTIVE[1])
  })

  it("matches the seeded Staff Writer by name, whatever the email", () => {
    expect(
      findLookAlike(
        { name: "staff writer", email: "new.person@gmail.com" },
        ACTIVE
      )
    ).toBe(ACTIVE[2])
  })

  it("returns the first active member that matches", () => {
    const twins = [
      { name: "Ana Reyes", email: "ana.one@example.com" },
      { name: "Ana Reyes", email: "ana.two@example.com" },
    ]
    expect(
      findLookAlike({ name: "Ana Reyes", email: "x@example.com" }, twins)
    ).toBe(twins[0])
  })

  it.each([
    ["a different name and email", "Pedro Penduko", "pedro@example.com"],
    ["a name that only contains another", "Juan", "j@example.com"],
    ["the same domain only", "Someone New", "newbie@gmail.com"],
    [
      "an email local part that keeps a different suffix",
      "X Y",
      "juansantos2@example.com",
    ],
  ])("returns null for %s", (_label, name, email) => {
    expect(findLookAlike({ name, email }, ACTIVE)).toBeNull()
  })

  it("never matches on values that normalize to nothing", () => {
    const blankish = [{ name: "!!!", email: "+news@example.com" }]
    expect(
      findLookAlike({ name: "???", email: "+other@example.com" }, blankish)
    ).toBeNull()
    expect(
      findLookAlike({ name: "", email: "" }, [{ name: "", email: "" }])
    ).toBeNull()
  })

  it("returns null when nobody is active", () => {
    expect(
      findLookAlike({ name: "Ana", email: "ana@example.com" }, [])
    ).toBeNull()
  })
})
