// The positions the approval picker offers (Story 2.2, UX-DR53), grouped as
// Staff, Section Editors, Heads, Top editors and Management. The groups come
// from the `positions` flags, so they follow the reference data rather than a
// list of ids: Staff is every position off the Board, a Section Editor heads a
// content section, a Head heads a desk, a top editor is one of the three top
// editors, and Management is every other Board position.
//
// Editor-in-Chief is never offered: Epic 5 transfers it, and approve_member
// refuses it. supabase/tests/members/approval.test.sql checks the same split
// (6/5/5/2/3, 21 offered) against the database.
//
// No imports, so the server query and client components share it.

export const EDITOR_IN_CHIEF_POSITION_ID = "editor_in_chief"

/** How many positions can be offered: every position but Editor-in-Chief. */
export const OFFERED_POSITION_COUNT = 21

export const POSITION_GROUP_LABELS = {
  staff: "Staff",
  section_editors: "Section Editors",
  heads: "Heads",
  top_editors: "Top editors",
  management: "Management",
} as const

export type PositionGroupId = keyof typeof POSITION_GROUP_LABELS

/** The order the picker shows the groups in. */
export const POSITION_GROUP_ORDER: readonly PositionGroupId[] = [
  "staff",
  "section_editors",
  "heads",
  "top_editors",
  "management",
]

/** A `positions` row, as the query selects it. */
export type PositionRow = {
  id: string
  title: string
  is_board: boolean
  is_top_editor: boolean
  heads_desk_id: string | null
  heads_section_id: string | null
  sort_order: number
}

export type OfferedPosition = { id: string; title: string }

export type PositionGroup = {
  id: PositionGroupId
  label: string
  positions: OfferedPosition[]
}

export function positionGroupOf(row: PositionRow): PositionGroupId {
  if (!row.is_board) return "staff"
  if (row.heads_section_id !== null) return "section_editors"
  if (row.heads_desk_id !== null) return "heads"
  if (row.is_top_editor) return "top_editors"
  return "management"
}

/**
 * The offered positions in their groups, in group order, each group in
 * `sort_order` (then id). Editor-in-Chief is left out, and a group with no
 * position is dropped.
 */
export function groupOfferedPositions(
  rows: readonly PositionRow[]
): PositionGroup[] {
  const sorted = rows
    .filter((row) => row.id !== EDITOR_IN_CHIEF_POSITION_ID)
    .toSorted(
      (a, b) =>
        a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )

  return POSITION_GROUP_ORDER.map((id) => ({
    id,
    label: POSITION_GROUP_LABELS[id],
    positions: sorted
      .filter((row) => positionGroupOf(row) === id)
      .map((row) => ({ id: row.id, title: row.title })),
  })).filter((group) => group.positions.length > 0)
}
