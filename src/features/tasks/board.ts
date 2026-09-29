// The Board's owner filter as URL text and as copy. Client-safe: no
// `server-only`, and no values from @/features/members (the filter's shape is
// the same union as its HomeScope, restated here so the two slices stay
// independent of each other at the type level).

export type TaskOwnerOption = {
  kind: "section" | "desk"
  id: string
  name: string
}

export type OwnerFilter =
  | { kind: "all" }
  | { kind: "articles" }
  | { kind: "section"; id: string }
  | { kind: "desk"; id: string }

/** The `owner` search parameter's value for a filter (the task form's composite form). */
export function ownerFilterParam(filter: OwnerFilter): string {
  switch (filter.kind) {
    case "all":
      return "all"
    case "articles":
      return "articles"
    case "section":
      return `section:${filter.id}`
    case "desk":
      return `desk:${filter.id}`
  }
}

/**
 * The filter an `owner` parameter names, or null for anything else: a
 * missing value, a repeated parameter (an array), an unknown id, and the
 * Writers desk, which owns no task and so isn't in `owners`.
 */
export function parseOwnerFilterParam(
  value: unknown,
  owners: TaskOwnerOption[]
): OwnerFilter | null {
  if (typeof value !== "string") return null
  if (value === "all") return { kind: "all" }
  if (value === "articles") return { kind: "articles" }

  const separator = value.indexOf(":")
  if (separator === -1) return null
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (kind !== "section" && kind !== "desk") return null

  const owner = owners.find(
    (option) => option.kind === kind && option.id === id
  )
  return owner ? { kind: owner.kind, id: owner.id } : null
}

/**
 * The h2 shown when a filter has no tasks, or null for All (which shows its
 * four empty columns instead).
 */
export function boardEmptyMessage(
  filter: OwnerFilter,
  owners: TaskOwnerOption[]
): string | null {
  switch (filter.kind) {
    case "all":
      return null
    case "articles":
      return "No tasks in any section right now."
    case "section":
    case "desk": {
      const name =
        owners.find(
          (option) => option.kind === filter.kind && option.id === filter.id
        )?.name ?? filter.id
      return `No tasks in ${name} right now.`
    }
  }
}

/**
 * The Board row's height, shared by the Board and its skeleton so the swap
 * between them doesn't jump: the rest of the viewport under the header, h1
 * and filter (tuned at 375, 800 and 1280px), and never so short that a column
 * is unusable (the page scrolls instead).
 */
export const BOARD_ROW_HEIGHT = "h-[calc(100dvh-20rem)] min-h-96"
