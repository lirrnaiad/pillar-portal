// The "possible second account" check on /admin/members (Story 2.2). The
// rule is an [ASSUMPTION] the Board hasn't confirmed: a pending member
// resembles an active one when their names match once case, accents,
// punctuation, symbols and all spacing are ignored (only letters and digits
// count, so "O'Neil" matches "ONeil" and "De la Cruz" matches "Delacruz"), or
// their email local parts match once case, dots and anything after "+" are
// ignored. A match only asks the admin to confirm; it never blocks an
// approval.
//
// No imports, so it is the same on the server (which computes the match) and
// in tests.

export type LookAlikeMember = { name: string; email: string }

/**
 * A name with accents dropped (NFKD, then no combining marks), lowercased,
 * and only its letters and digits kept: punctuation, symbols and every kind
 * of whitespace are removed. "José O'Neil-Dela Cruz" → "joseoneildelacruz".
 */
export function normalizedName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
}

/**
 * An email's local part (before the last "@"), lowercased, cut at the first
 * "+", with every dot removed. "Jo.Cruz+pillar@gmail.com" → "jocruz".
 */
export function normalizedEmailLocal(email: string): string {
  const at = email.lastIndexOf("@")
  const local = (at === -1 ? email : email.slice(0, at)).toLowerCase()
  const plus = local.indexOf("+")
  return (plus === -1 ? local : local.slice(0, plus)).replaceAll(".", "")
}

/**
 * The first of `active` whose name or email local part matches the
 * candidate's once normalized, else null. A value that normalizes to nothing
 * never matches, so a name of punctuation or a "+tag" local part can't make
 * every member look alike.
 */
export function findLookAlike<T extends LookAlikeMember>(
  candidate: LookAlikeMember,
  active: readonly T[]
): T | null {
  const name = normalizedName(candidate.name)
  const local = normalizedEmailLocal(candidate.email)

  return (
    active.find(
      (member) =>
        (name !== "" && normalizedName(member.name) === name) ||
        (local !== "" && normalizedEmailLocal(member.email) === local)
    ) ?? null
  )
}
