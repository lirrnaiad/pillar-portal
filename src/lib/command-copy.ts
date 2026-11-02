// Copy every slice's commands share (EXPERIENCE.md). Client-safe: no imports,
// so a slice's errors.ts, which its client components import, can use it.

/**
 * EXPERIENCE.md's stale line: a command found its row changed since the page
 * loaded (another admin or approver acted first), so the view reloads.
 */
export const STALE_COPY =
  "Something changed since you opened this. Review the latest and try again."
