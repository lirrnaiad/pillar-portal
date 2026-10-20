import { Skeleton } from "@/components/ui/skeleton"

// /admin/members' lists in outline while getMemberApprovals runs: the
// "Awaiting approval" heading and two pending cards with their button rows,
// then the "Active members" heading and the roster. The page's h1 sits
// outside the Suspense boundary, so it isn't repeated here.
export function MemberApprovalsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-6 max-w-3xl">
      <span className="sr-only">Loading members</span>
      <Skeleton className="h-5 w-40" />
      <div className="mt-3 flex flex-col gap-3">
        {[0, 1].map((n) => (
          <div key={n} className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-11 w-36" />
              <Skeleton className="h-11 w-24" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-8 h-5 w-36" />
      <div className="mt-3 flex flex-col gap-2">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-18 w-full" />
        ))}
      </div>
    </div>
  )
}
