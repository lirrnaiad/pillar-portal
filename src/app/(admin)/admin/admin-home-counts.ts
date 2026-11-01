import { countPendingApprovalsForViewer } from "@/features/members"
import {
  countReviewQueueForViewer,
  getHandedBackForViewer,
} from "@/features/tasks"

import type { AdminHomeCard, AdminHomeRow } from "./admin-home"

type AdminHomeCardSource = Pick<AdminHomeCard, "id" | "label" | "href">

/**
 * One Admin home card's source, read for the viewer on each request. A link
 * card reads its `count`; a list card reads its `rows`, counts them, and
 * ends in a link labelled `linkLabel`.
 */
export type AdminHomeCount =
  | (AdminHomeCardSource & { count: () => Promise<number> })
  | (AdminHomeCardSource & {
      linkLabel: string
      rows: () => Promise<AdminHomeRow[]>
    })

/**
 * The Needs reassignment card's rows, from one getHandedBackForViewer()
 * read: "<task title> · <role> · <previous assignee>", and the reason when
 * given.
 */
async function handedBackRows(): Promise<AdminHomeRow[]> {
  const slots = await getHandedBackForViewer()
  return slots.map((slot) => ({
    id: slot.slotId,
    text: `${slot.taskTitle} · ${slot.roleLabel} · ${slot.memberName}`,
    reason: slot.reason,
  }))
}

/**
 * Admin home's cards, in display order. Each reader is a slice's
 * `count<Thing>ForViewer()` or `get<Thing>ForViewer()` from its index.ts. It
 * returns 0 or no rows, without a query, for anyone but an active
 * editorial_admin; for them, Postgres decides the rest (RLS and
 * task_capabilities, AD-4). It throws when its query fails. A story adding a
 * card adds one entry where it shows; no other entry changes.
 */
export const ADMIN_HOME_COUNTS: readonly AdminHomeCount[] = [
  {
    id: "pending-approvals",
    label: "Awaiting approval",
    href: "/admin/members",
    count: countPendingApprovalsForViewer,
  },
  {
    id: "handed-back",
    label: "Needs reassignment",
    href: "/admin/tasks",
    linkLabel: "Reassign in Tasks",
    rows: handedBackRows,
  },
  {
    id: "review-queue",
    label: "Waiting for your review",
    href: "/admin/tasks",
    count: countReviewQueueForViewer,
  },
]
