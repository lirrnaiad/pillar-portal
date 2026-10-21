import "server-only"

import type { AdminBanner } from "@/lib/admin-banners"
import { isProduction } from "@/lib/env.server"
import { createClient } from "@/lib/supabase/server"

/**
 * A backup is overdue once the newest successful one finished more than this
 * many days ago. The backup runs weekly, so a missed or failed run shows a
 * day after it was due.
 */
export const BACKUP_OVERDUE_DAYS = 8

const DAY_MS = 24 * 60 * 60 * 1000
const OVERDUE_MS = BACKUP_OVERDUE_DAYS * DAY_MS

const BACKUP_BANNER_ID = "backup-overdue"

// With no backup at all, the condition has held since production began, so
// `since` is the epoch and the bar sorts first among the attention banners.
const NO_BACKUP_SINCE = new Date(0).toISOString()

/**
 * The overdue-backup banner (Story 2.5) for the newest successful backup's
 * finish time, or null when that backup is recent enough. `lastBackupAt` is
 * null when no backup has succeeded yet. Overdue means more than
 * BACKUP_OVERDUE_DAYS × 24 hours before `now`; exactly that long is still
 * on time. The text counts the whole days elapsed, and `since` is when the
 * backup became overdue. There is no Cancel: only a backup clears it.
 */
export function backupBannerOf(
  lastBackupAt: string | null,
  now: Date
): AdminBanner | null {
  if (lastBackupAt === null) {
    return {
      id: BACKUP_BANNER_ID,
      family: "attention",
      text: "No backup has run yet.",
      since: NO_BACKUP_SINCE,
    }
  }

  const finishedAt = Date.parse(lastBackupAt)
  if (Number.isNaN(finishedAt)) {
    throw new RangeError(
      "backupBannerOf: the last backup's finish time isn't a timestamp"
    )
  }

  const elapsed = now.getTime() - finishedAt
  if (elapsed <= OVERDUE_MS) return null

  return {
    id: BACKUP_BANNER_ID,
    family: "attention",
    text: `Last backup was ${Math.floor(elapsed / DAY_MS)} days ago.`,
    since: new Date(finishedAt + OVERDUE_MS).toISOString(),
  }
}

/**
 * The admin banner source for overdue backups (one entry in
 * ADMIN_BANNER_SOURCES). Only production is backed up, so anywhere else it
 * returns [] without a query. In production it reads the newest `ok` run of
 * the `backup` job through the admin's own session (RLS lets only admins
 * read `job_runs`). A failed query throws; the banner slot logs and records
 * it, and the other banners still show.
 */
export async function backupBanner(): Promise<AdminBanner[]> {
  if (!isProduction) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("job_runs")
    .select("finished_at")
    .eq("job", "backup")
    .eq("status", "ok")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error("backupBanner: reading the last backup failed", {
      cause: error,
    })
  }

  const banner = backupBannerOf(data?.finished_at ?? null, new Date())
  return banner ? [banner] : []
}
