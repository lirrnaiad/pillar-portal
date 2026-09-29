import type { Metadata } from "next"

import { getWhatsMine, WhatsMineTasks } from "@/features/tasks"

export const metadata: Metadata = {
  title: "What's mine · The Pillar Portal",
}

const HEADING_ID = "whats-mine-heading"

// What's mine (EXPERIENCE.md). Reads as the viewer on every request. The h1
// is the focus target when an answered Waiting item leaves the page.
export default async function DashboardPage() {
  const whatsMine = await getWhatsMine()
  const empty = whatsMine.waiting.length === 0 && whatsMine.tasks.length === 0

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        What&apos;s mine
      </h1>
      {empty ? (
        <div className="mt-6 text-muted-foreground">
          <h2 className="text-heading-sm">Nothing on your plate right now.</h2>
          <p className="mt-1">
            New assignments will show up here — your editor or head will also
            message you.
          </p>
        </div>
      ) : (
        <WhatsMineTasks whatsMine={whatsMine} focusTargetId={HEADING_ID} />
      )}
    </>
  )
}
