/**
 * Up to two initials for an avatar: the first character of the first and of
 * the last word (words split on whitespace and hyphens, so "Editor-in-Chief"
 * is "EC"). Characters are code points, so a name starting with an emoji
 * keeps the whole emoji rather than half a surrogate pair.
 */
export function initialsOf(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean)
  if (words.length === 0) return "?"
  const firstOf = (word: string) => Array.from(word)[0] ?? ""
  const first = firstOf(words[0])
  const last = words.length > 1 ? firstOf(words[words.length - 1]) : ""
  return `${first}${last}`.toUpperCase()
}
