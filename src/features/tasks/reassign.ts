// The reassign picker's list (Story 3.3), client-safe: no labels from the
// members barrel, no server reads. The picker takes its members as data from
// getReassignOptions().

/** A member the picker can list, with their open slots (their load). */
export type ReassignMember = {
  id: string
  name: string
  openSlots: number
}

/** A listed member; `current` marks the slot's own member. */
export type ReassignRow = ReassignMember & { current: boolean }

export type ReassignList = {
  /** Lowest load first, then name, then id. */
  rows: ReassignRow[]
  /**
   * Offer Show everyone: the desk list is non-empty and, with the current
   * member, still shorter than everyone.
   */
  canShowEveryone: boolean
  /** No one is on the role's desk, so the list is everyone, under REASSIGN_EMPTY_DESK. */
  emptyDesk: boolean
}

export const REASSIGN_EMPTY_DESK = "No one on this desk yet — showing everyone."

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Lowest load first, then name (in English collation, so every viewer gets
 * the same order), then id, whatever order they came in.
 */
export function sortByLoad<T extends ReassignMember>(
  members: readonly T[]
): T[] {
  return [...members].sort(
    (a, b) =>
      a.openSlots - b.openSlots ||
      a.name.localeCompare(b.name, "en") ||
      compareIds(a.id, b.id)
  )
}

/**
 * Who the picker lists for one slot: the role's desk, or everyone with Show
 * everyone or when the desk is empty. The slot's own member is listed while
 * they're active (in `allMembers`), on the desk or not, and marked current;
 * one who isn't active any more isn't listed.
 */
export function buildReassignList({
  deskMembers,
  allMembers,
  currentMemberId,
  showEveryone,
}: {
  deskMembers: readonly ReassignMember[]
  allMembers: readonly ReassignMember[]
  currentMemberId: string
  showEveryone: boolean
}): ReassignList {
  const current = allMembers.find((member) => member.id === currentMemberId)
  const withCurrent = (members: readonly ReassignMember[]) =>
    current !== undefined && !members.some((member) => member.id === current.id)
      ? [...members, current]
      : members
  const emptyDesk = deskMembers.length === 0
  // The desk list as shown, the current member included: Show everyone is
  // offered only when it would add someone.
  const narrowed = withCurrent(deskMembers)
  const canShowEveryone = !emptyDesk && narrowed.length < allMembers.length
  const listed = emptyDesk || showEveryone ? withCurrent(allMembers) : narrowed

  return {
    rows: sortByLoad(listed).map((member) => ({
      ...member,
      current: member.id === currentMemberId,
    })),
    canShowEveryone,
    emptyDesk,
  }
}

/** "<name> · <n> active", with " (current)" on the slot's own member. */
export function reassignRowLabel(row: ReassignRow): string {
  return `${row.name} · ${row.openSlots} active${row.current ? " (current)" : ""}`
}

/** The success toast. */
export function reassignedMessage(name: string): string {
  return `Reassigned to ${name}.`
}

/** tasks.duplicate_slot in the picker, naming the member picked. */
export function duplicateSlotMessage(name: string): string {
  return `${name} already has this role on this task.`
}
