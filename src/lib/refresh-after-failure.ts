// After a refused or failed save, a component re-reads the page so it shows
// what the database holds. Offline that re-read fails as well, and Next.js
// then falls back to a full browser navigation, which lands on the browser's
// own offline page. The optimistic change rolls back either way, so offline
// the re-read is skipped.
export function refreshAfterFailure(router: { refresh(): void }) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return
  router.refresh()
}
