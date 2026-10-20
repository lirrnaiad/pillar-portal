import { countPendingApprovalsForViewer } from "@/features/members"

import type { AdminHomeCard } from "./admin-home"

/** One Admin home card's source: its count is read for the viewer per request. */
export type AdminHomeCount = Omit<AdminHomeCard, "count"> & {
  count: () => Promise<number>
}

/**
 * Admin home's cards, in display order. Each `count` is a slice's
 * `count<Thing>ForViewer()` from its index.ts, which returns 0 for anyone but
 * an active admin who may act on it, and throws when its query fails. A story
 * adding a card appends one entry; no other entry changes.
 */
export const ADMIN_HOME_COUNTS: readonly AdminHomeCount[] = [
  {
    id: "pending-approvals",
    label: "Awaiting approval",
    href: "/admin/members",
    count: countPendingApprovalsForViewer,
  },
]
