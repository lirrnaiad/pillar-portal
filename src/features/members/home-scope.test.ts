import { describe, expect, it } from "vitest"

import { homeScopeOf, type HomeScopePosition } from "./home-scope"

// Each row copies a position's desk_id / heads_section_id from
// 20260927141747_core_org_reference_data.sql.
const primary = (
  deskId: string | null,
  headsSectionId: string | null = null
): HomeScopePosition[] => [{ isPrimary: true, deskId, headsSectionId }]

describe("homeScopeOf", () => {
  it("sends a desk Staff member to their desk (Staff Layout Artist)", () => {
    expect(homeScopeOf(primary("layout"))).toEqual({
      kind: "desk",
      id: "layout",
    })
  })

  it("sends a desk Head to their desk (Head Layout Artist)", () => {
    expect(homeScopeOf(primary("layout"))).toEqual({
      kind: "desk",
      id: "layout",
    })
    expect(homeScopeOf(primary("photo"))).toEqual({
      kind: "desk",
      id: "photo",
    })
  })

  it("sends a Section Editor to their section (News Editor)", () => {
    expect(homeScopeOf(primary("writers", "news"))).toEqual({
      kind: "section",
      id: "news",
    })
  })

  it("sends a Staff Writer to all articles", () => {
    expect(homeScopeOf(primary("writers"))).toEqual({ kind: "articles" })
  })

  it("sends a top editor to All (Editor-in-Chief)", () => {
    expect(homeScopeOf(primary(null))).toEqual({ kind: "all" })
  })

  it("sends management to All (Finance Manager)", () => {
    expect(homeScopeOf(primary(null, null))).toEqual({ kind: "all" })
  })

  it("uses only the primary position", () => {
    expect(
      homeScopeOf([
        { isPrimary: false, deskId: "photo", headsSectionId: null },
        { isPrimary: true, deskId: "writers", headsSectionId: "sports" },
      ])
    ).toEqual({ kind: "section", id: "sports" })
  })

  it("sends a list with no primary position to All", () => {
    expect(
      homeScopeOf([
        { isPrimary: false, deskId: "layout", headsSectionId: null },
      ])
    ).toEqual({ kind: "all" })
    expect(homeScopeOf([])).toEqual({ kind: "all" })
  })
})
