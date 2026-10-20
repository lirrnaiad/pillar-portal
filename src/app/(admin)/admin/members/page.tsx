import { Suspense } from "react"
import type { Metadata } from "next"

import {
  getMemberApprovals,
  MemberApprovals,
  MemberApprovalsSkeleton,
} from "@/features/members"

import { requireAdmin } from "../../require-admin"

export const metadata: Metadata = {
  title: "Members · The Pillar Portal",
}

// Any admin approves or declines new sign-ins here (Story 2.2). The admin
// check comes first, before the Suspense boundary: a redirect thrown inside a
// streamed boundary would arrive as a client-side meta refresh. The layout's
// own check doesn't stop this page rendering. approve_member and
// decline_member are the actual authority (AD-4).
export default async function AdminMembersPage() {
  await requireAdmin()

  return (
    <>
      <h1 className="font-heading text-display text-navy">Members</h1>
      <Suspense fallback={<MemberApprovalsSkeleton />}>
        <MemberApprovalsList />
      </Suspense>
    </>
  )
}

// Reads both lists on every request (no cache), inside the boundary so the
// skeleton shows while they load.
async function MemberApprovalsList() {
  const approvals = await getMemberApprovals()
  return <MemberApprovals approvals={approvals} />
}
