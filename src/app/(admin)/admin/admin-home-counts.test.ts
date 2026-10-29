import { describe, expect, it, vi } from "vitest"

const { countPendingApprovalsForViewer, countReviewQueueForViewer } =
  vi.hoisted(() => ({
    countPendingApprovalsForViewer: vi.fn(),
    countReviewQueueForViewer: vi.fn(),
  }))
vi.mock("@/features/members", () => ({ countPendingApprovalsForViewer }))
vi.mock("@/features/tasks", () => ({ countReviewQueueForViewer }))

import { ADMIN_HOME_COUNTS } from "./admin-home-counts"

describe("ADMIN_HOME_COUNTS", () => {
  it("is the approvals card, then the review queue's, each counted by its slice", () => {
    expect(ADMIN_HOME_COUNTS).toEqual([
      {
        id: "pending-approvals",
        label: "Awaiting approval",
        href: "/admin/members",
        count: countPendingApprovalsForViewer,
      },
      {
        id: "review-queue",
        label: "Waiting for your review",
        href: "/admin/tasks",
        count: countReviewQueueForViewer,
      },
    ])
  })
})
