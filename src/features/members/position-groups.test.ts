import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  EDITOR_IN_CHIEF_POSITION_ID,
  groupOfferedPositions,
  OFFERED_POSITION_COUNT,
  type PositionRow,
} from "./position-groups"

// The 22 positions exactly as the reference-data migration inserts them, so
// the groups follow the real flags rather than a fixture.
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260927141747_core_org_reference_data.sql",
    import.meta.url
  ),
  "utf8"
)

const sqlValue = (value: string) =>
  value === "null" ? null : value.replace(/^'|'$/g, "")

const ROWS: PositionRow[] = [
  ...migration.matchAll(
    /^\s*\('([a-z_]+)', '([^']+)', '[^']+', ('[a-z_]+'|null), ('[a-z_]+'|null), ('[a-z_]+'|null), (true|false), (true|false), (\d+)\)/gm
  ),
].map(([, id, title, , headsDesk, headsSection, topEditor, board, sort]) => ({
  id,
  title,
  heads_desk_id: sqlValue(headsDesk),
  heads_section_id: sqlValue(headsSection),
  is_top_editor: topEditor === "true",
  is_board: board === "true",
  sort_order: Number(sort),
}))

describe("groupOfferedPositions", () => {
  it("reads all 22 positions from the reference-data migration", () => {
    expect(ROWS).toHaveLength(22)
  })

  it("offers the 21 positions other than Editor-in-Chief in five groups, 6/5/5/2/3", () => {
    const groups = groupOfferedPositions(ROWS)

    expect(
      groups.map((group) => [group.label, group.positions.length])
    ).toEqual([
      ["Staff", 6],
      ["Section Editors", 5],
      ["Heads", 5],
      ["Top editors", 2],
      ["Management", 3],
    ])
    const offered = groups.flatMap((group) => group.positions)
    expect(offered).toHaveLength(OFFERED_POSITION_COUNT)
    expect(offered.map((position) => position.id)).not.toContain(
      EDITOR_IN_CHIEF_POSITION_ID
    )
  })

  it("lists each group's positions in sort_order, with their titles", () => {
    const groups = groupOfferedPositions(ROWS.toReversed())

    expect(
      Object.fromEntries(
        groups.map((group) => [
          group.id,
          group.positions.map((position) => position.title),
        ])
      )
    ).toEqual({
      staff: [
        "Staff Writer",
        "Staff Layout Artist",
        "Staff Cartoonist",
        "Staff Photojournalist",
        "Staff Videojournalist",
        "Staff Broadcast Journalist",
      ],
      section_editors: [
        "News Editor",
        "Sports Editor",
        "Feature Editor",
        "Sci-Tech Editor",
        "Culture Editor",
      ],
      heads: [
        "Head Layout Artist",
        "Head Cartoonist",
        "Head Photojournalist",
        "Head Videojournalist",
        "Head Broadcast Journalist",
      ],
      top_editors: ["Associate Editor", "Managing Editor"],
      management: [
        "Finance Manager",
        "Assistant Finance Manager",
        "Online Manager",
      ],
    })
  })

  it("has no Technical Adviser to offer", () => {
    const titles = groupOfferedPositions(ROWS).flatMap((group) =>
      group.positions.map((position) => position.title)
    )
    expect(titles.filter((title) => /advis[eo]r/i.test(title))).toEqual([])
  })

  it("drops a group with no position", () => {
    const staffOnly = ROWS.filter((row) => !row.is_board)
    expect(groupOfferedPositions(staffOnly).map((group) => group.id)).toEqual([
      "staff",
    ])
    expect(
      groupOfferedPositions(
        ROWS.filter((row) => row.id === EDITOR_IN_CHIEF_POSITION_ID)
      )
    ).toEqual([])
  })
})
