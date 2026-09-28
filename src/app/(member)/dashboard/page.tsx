import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "What's mine · The Pillar Portal",
}

// What's mine (EXPERIENCE.md). Until tasks exist (Story 1.7), it is always
// the "Nothing assigned" state.
export default function DashboardPage() {
  return (
    <>
      <h1 className="font-heading text-display text-navy">What&apos;s mine</h1>
      <div className="mt-6 text-muted-foreground">
        <p className="font-medium">Nothing on your plate right now.</p>
        <p className="mt-1">
          New assignments will show up here — your editor or head will also
          message you.
        </p>
      </div>
    </>
  )
}
