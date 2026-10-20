import type { MemberApprovalsData } from "../queries"
import { PendingMemberCard } from "./pending-member-card"

const AWAITING_HEADING_ID = "awaiting-approval-heading"
const ACTIVE_HEADING_ID = "active-members-heading"

/**
 * /admin/members' two lists (Story 2.2): "Awaiting approval", one card per
 * pending member, oldest first, and the read-only "Active members" roster by
 * name, each with their positions, the primary first (Epic 5 adds changes).
 * An approved or declined member leaves the first list, so the heading is
 * where focus goes then.
 */
export function MemberApprovals({
  approvals,
}: {
  approvals: MemberApprovalsData
}) {
  const { pending, roster, positionGroups } = approvals

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-8">
      <section aria-labelledby={AWAITING_HEADING_ID}>
        <h2
          id={AWAITING_HEADING_ID}
          tabIndex={-1}
          className="rounded-sm text-heading-sm text-navy outline-offset-2 focus-visible:outline-2"
        >
          Awaiting approval
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-muted-foreground">
            No one is waiting for approval.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((member) => (
              <PendingMemberCard
                key={member.id}
                member={member}
                positionGroups={positionGroups}
                focusTargetId={AWAITING_HEADING_ID}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={ACTIVE_HEADING_ID}>
        <h2 id={ACTIVE_HEADING_ID} className="text-heading-sm text-navy">
          Active members
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-lg bg-card shadow-card">
          {roster.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-0.5 p-card-padding"
            >
              <p className="font-medium break-words">{member.name}</p>
              <p className="text-sm break-all text-muted-foreground">
                {member.email}
              </p>
              <p className="text-sm">{member.positionTitles.join(" · ")}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
