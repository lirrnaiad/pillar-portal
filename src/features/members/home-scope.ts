// The Board's default owner filter, derived from a member's primary position
// alone. No imports, so it stays testable without Supabase.

/** The Writers desk owns no tasks; its members' home is "all articles". */
export const WRITERS_DESK_ID = "writers"

export type HomeScope =
  | { kind: "all" }
  | { kind: "articles" }
  | { kind: "section"; id: string }
  | { kind: "desk"; id: string }

export type HomeScopePosition = {
  isPrimary: boolean
  deskId: string | null
  headsSectionId: string | null
}

/**
 * A Section Editor → their content section (checked first: they sit on the
 * Writers desk too); a Staff Writer → all articles; any other desk Staff
 * member or Head → their desk; top editors, management, or no primary
 * position → all.
 */
export function homeScopeOf(positions: HomeScopePosition[]): HomeScope {
  const primary = positions.find((position) => position.isPrimary)
  if (!primary) return { kind: "all" }
  if (primary.headsSectionId) {
    return { kind: "section", id: primary.headsSectionId }
  }
  if (primary.deskId === WRITERS_DESK_ID) return { kind: "articles" }
  if (primary.deskId) return { kind: "desk", id: primary.deskId }
  return { kind: "all" }
}
