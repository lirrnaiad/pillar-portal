import type { AdminBanner } from "@/lib/admin-banners"

import { backupBanner } from "./backup-banner"

/**
 * Every admin banner's source (Story 2.3's slot). Each entry is one function
 * owned by the story whose condition it reports (Story 2.5's overdue backup,
 * Epic 6's scheduled reset, …), usually exported from its slice's index.ts.
 * It reads through the caller's session, so RLS decides what it sees, and
 * returns the banners showing now as `AdminBanner`s, or [] when there is
 * nothing to show this viewer. There is no cache. To add one, import it here
 * and append it; no other entry changes. The slot (admin-banners.tsx) sorts
 * and caps them all together, and logs and skips a source that throws,
 * recording it as `render admin-banners #<index here>`, so an entry keeps its
 * index.
 *
 * The slot lives in the admin layout, and Next doesn't re-render a shared
 * layout on a client-side navigation, so banners are read on a full load, a
 * `router.refresh()` or a layout revalidation, not on every link followed.
 */
export const ADMIN_BANNER_SOURCES: (() => Promise<AdminBanner[]>)[] = [
  // #0, Story 2.5: the newest successful backup is over 8 days old, or none
  // has run (production only).
  backupBanner,
]
