import { Skeleton } from "@/components/ui/skeleton"

// Admin home's cards in outline while the counts are read: one card in the
// cards' grid. The page's h1 sits outside the Suspense boundary, so it isn't
// repeated here.
export function AdminHomeSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-6">
      <span className="sr-only">Loading admin home</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[50px] w-full rounded-lg" />
      </div>
    </div>
  )
}
