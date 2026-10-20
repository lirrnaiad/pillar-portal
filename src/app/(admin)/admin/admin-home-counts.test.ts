import { describe, expect, it, vi } from "vitest"

const { countPendingApprovalsForViewer } = vi.hoisted(() => ({
  countPendingApprovalsForViewer: vi.fn(),
}))
vi.mock("@/features/members", () => ({ countPendingApprovalsForViewer }))

import { ADMIN_HOME_COUNTS } from "./admin-home-counts"

describe("ADMIN_HOME_COUNTS", () => {
  it("is the one approvals card, counted by the members slice", () => {
    expect(ADMIN_HOME_COUNTS).toEqual([
      {
        id: "pending-approvals",
        label: "Awaiting approval",
        href: "/admin/members",
        count: countPendingApprovalsForViewer,
      },
    ])
  })
})
