import { describe, expect, it } from "vitest"

import {
  buildReassignList,
  duplicateSlotMessage,
  REASSIGN_EMPTY_DESK,
  reassignedMessage,
  reassignRowLabel,
  sortByLoad,
  type ReassignMember,
} from "./reassign"

const member = (
  id: string,
  name: string,
  openSlots: number
): ReassignMember => ({
  id: `00000000-0000-4000-8000-0000000000${id}`,
  name,
  openSlots,
})

const ANA = member("01", "Ana", 2)
const BEA = member("02", "Bea", 0)
const CARL = member("03", "Carl", 1)
const DANI = member("04", "Dani", 0)
const EVERYONE = [ANA, BEA, CARL, DANI]

describe("sortByLoad", () => {
  it("puts the lowest load first, then sorts by name", () => {
    expect(sortByLoad([ANA, CARL, DANI, BEA]).map((m) => m.name)).toEqual([
      "Bea",
      "Dani",
      "Carl",
      "Ana",
    ])
  })

  it("breaks a tie in load and name by id, whatever order they came in", () => {
    const first = member("21", "Sam", 1)
    const second = member("22", "Sam", 1)
    expect(sortByLoad([second, first])).toEqual([first, second])
    expect(sortByLoad([first, second])).toEqual([first, second])
  })

  it("leaves its input alone", () => {
    const input = [ANA, BEA]
    sortByLoad(input)
    expect(input).toEqual([ANA, BEA])
  })
})

describe("buildReassignList", () => {
  it("lists the role's desk, lowest load first, marking the slot's member current", () => {
    const list = buildReassignList({
      deskMembers: [ANA, CARL],
      allMembers: EVERYONE,
      currentMemberId: ANA.id,
      showEveryone: false,
    })

    expect(list.rows).toEqual([
      { ...CARL, current: false },
      { ...ANA, current: true },
    ])
    expect(list.canShowEveryone).toBe(true)
    expect(list.emptyDesk).toBe(false)
  })

  it("lists everyone with Show everyone", () => {
    const list = buildReassignList({
      deskMembers: [ANA, CARL],
      allMembers: EVERYONE,
      currentMemberId: ANA.id,
      showEveryone: true,
    })

    expect(list.rows.map((row) => row.name)).toEqual([
      "Bea",
      "Dani",
      "Carl",
      "Ana",
    ])
    expect(list.canShowEveryone).toBe(true)
  })

  it("lists an active current member who isn't on the desk with it", () => {
    const list = buildReassignList({
      deskMembers: [CARL],
      allMembers: EVERYONE,
      currentMemberId: BEA.id,
      showEveryone: false,
    })

    expect(list.rows).toEqual([
      { ...BEA, current: true },
      { ...CARL, current: false },
    ])
  })

  it("doesn't list a current member who isn't active any more", () => {
    const list = buildReassignList({
      deskMembers: [CARL],
      allMembers: EVERYONE,
      currentMemberId: "00000000-0000-4000-8000-0000000000ff",
      showEveryone: true,
    })

    expect(list.rows.some((row) => row.current)).toBe(false)
    expect(list.rows).toHaveLength(4)
  })

  it("lists everyone, offering no Show everyone, when no one is on the desk", () => {
    const list = buildReassignList({
      deskMembers: [],
      allMembers: EVERYONE,
      currentMemberId: ANA.id,
      showEveryone: false,
    })

    expect(list.emptyDesk).toBe(true)
    expect(list.canShowEveryone).toBe(false)
    expect(list.rows.map((row) => row.name)).toEqual([
      "Bea",
      "Dani",
      "Carl",
      "Ana",
    ])
  })

  it("offers no Show everyone when the desk and an off-desk current member are already everyone", () => {
    const list = buildReassignList({
      deskMembers: [ANA, CARL, DANI],
      allMembers: EVERYONE,
      currentMemberId: BEA.id,
      showEveryone: false,
    })

    expect(list.canShowEveryone).toBe(false)
    expect(list.rows.map((row) => row.name)).toEqual([
      "Bea",
      "Dani",
      "Carl",
      "Ana",
    ])
  })

  it("offers no Show everyone when the desk is everyone", () => {
    const list = buildReassignList({
      deskMembers: EVERYONE,
      allMembers: EVERYONE,
      currentMemberId: ANA.id,
      showEveryone: false,
    })

    expect(list.canShowEveryone).toBe(false)
    expect(list.emptyDesk).toBe(false)
    expect(list.rows).toHaveLength(4)
  })

  it("lists the current member once when they're on the desk", () => {
    const list = buildReassignList({
      deskMembers: [ANA, CARL],
      allMembers: EVERYONE,
      currentMemberId: CARL.id,
      showEveryone: false,
    })

    expect(list.rows.filter((row) => row.id === CARL.id)).toHaveLength(1)
  })
})

describe("copy", () => {
  it("labels a row with its name and load, and the current member", () => {
    expect(reassignRowLabel({ ...ANA, current: false })).toBe("Ana · 2 active")
    expect(reassignRowLabel({ ...BEA, current: true })).toBe(
      "Bea · 0 active (current)"
    )
  })

  it("has the empty desk line, the success toast and the duplicate message", () => {
    expect(REASSIGN_EMPTY_DESK).toBe(
      "No one on this desk yet — showing everyone."
    )
    expect(reassignedMessage("Staff Writer")).toBe(
      "Reassigned to Staff Writer."
    )
    expect(duplicateSlotMessage("Staff Writer")).toBe(
      "Staff Writer already has this role on this task."
    )
  })
})
