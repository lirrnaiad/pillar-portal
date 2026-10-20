import { Suspense } from "react"
import type { Metadata } from "next"

import { requireAdmin } from "../require-admin"
import { AdminHomeCards } from "./admin-home"
import { ADMIN_HOME_COUNTS } from "./admin-home-counts"
import { AdminHomeSkeleton } from "./admin-home-skeleton"

export const metadata: Metadata = {
  title: "Admin home · The Pillar Portal",
}

// Admin home (Story 2.3): what needs an admin right now, one card per count.
// The admin check comes first, before the Suspense boundary: a redirect
// thrown inside a streamed boundary would arrive as a client-side meta
// refresh, and no count is read for anyone it turns away. The layout's own
// check doesn't stop this page rendering.
export default async function AdminHomePage() {
  await requireAdmin()

  return (
    <>
      <h1 className="font-heading text-display text-navy">Admin home</h1>
      <Suspense fallback={<AdminHomeSkeleton />}>
        <AdminHomeCountCards />
      </Suspense>
    </>
  )
}

// Reads every count in parallel on each request (no cache), inside the
// boundary so the skeleton shows while they load. A throwing count reaches
// Next's error page.
async function AdminHomeCountCards() {
  const cards = await Promise.all(
    ADMIN_HOME_COUNTS.map(async ({ count, ...card }) => ({
      ...card,
      count: await count(),
    }))
  )
  return <AdminHomeCards cards={cards} />
}
