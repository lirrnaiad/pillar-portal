import { afterEach, describe, expect, it, vi } from "vitest"

const {
  countPendingApprovalsForViewer,
  countReviewQueueForViewer,
  getHandedBackForViewer,
} = vi.hoisted(() => ({
  countPendingApprovalsForViewer: vi.fn(),
  countReviewQueueForViewer: vi.fn(),
  getHandedBackForViewer: vi.fn(),
}))
vi.mock("@/features/members", () => ({ countPendingApprovalsForViewer }))
vi.mock("@/features/tasks", () => ({
  countReviewQueueForViewer,
  getHandedBackForViewer,
}))

import { ADMIN_HOME_COUNTS } from "./admin-home-counts"

afterEach(() => {
  vi.clearAllMocks()
})

const slot = (n: number, title: string, reason: string | null) => ({
  slotId: `00000000-0000-4000-8000-00000000003${n}`,
  slotUpdatedAt: "2026-11-02T02:15:42.123456+00:00",
  taskId: `00000000-0000-4000-8000-00000000002${n}`,
  taskTitle: title,
  dueAt: "2099-01-01T00:00:00+00:00",
  role: "cartoonist",
  roleLabel: "Cartoonist",
  memberId: "00000000-0000-4000-8000-000000000001",
  memberName: "Editor-in-Chief",
  reason,
})

describe("ADMIN_HOME_COUNTS", () => {
  it("is the approvals card, then Needs reassignment, then the review queue's, each read through its slice", () => {
    expect(ADMIN_HOME_COUNTS).toEqual([
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
        rows: expect.any(Function),
      },
      {
        id: "review-queue",
        label: "Waiting for your review",
        href: "/admin/tasks",
        count: countReviewQueueForViewer,
      },
    ])
  })

  it("builds the Needs reassignment rows from one getHandedBackForViewer() read: '<task> · <role> · <previous assignee>', and the reason", async () => {
    getHandedBackForViewer.mockResolvedValue([
      slot(1, "3.7 check (edit) renamed", "Swamped with the issue"),
      slot(2, "test due next week", null),
    ])
    const entry = ADMIN_HOME_COUNTS[1]
    if (!("rows" in entry)) throw new Error("expected a list card")

    await expect(entry.rows()).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000031",
        text: "3.7 check (edit) renamed · Cartoonist · Editor-in-Chief",
        reason: "Swamped with the issue",
      },
      {
        id: "00000000-0000-4000-8000-000000000032",
        text: "test due next week · Cartoonist · Editor-in-Chief",
        reason: null,
      },
    ])
    expect(getHandedBackForViewer).toHaveBeenCalledOnce()
  })

  it("gives no rows (so no card) when the viewer has none, and lets a failed read throw", async () => {
    const entry = ADMIN_HOME_COUNTS[1]
    if (!("rows" in entry)) throw new Error("expected a list card")

    getHandedBackForViewer.mockResolvedValue([])
    await expect(entry.rows()).resolves.toEqual([])

    const failure = new Error("getHandedBackForViewer: reading tasks failed")
    getHandedBackForViewer.mockRejectedValue(failure)
    await expect(entry.rows()).rejects.toBe(failure)
  })
})
