import Link from "next/link"

/** One Admin home card's data: a count already read for the viewer. */
export type AdminHomeCard = {
  id: string
  label: string
  href: string
  count: number
}

/**
 * Admin home's count cards (Story 2.3): only what the admin can act on, so a
 * card shows only while its count is above 0, as "<label> (<n>)" in text
 * (never color alone), the whole card one link to where the work is. With
 * nothing to show, the all-clear heading.
 */
export function AdminHomeCards({ cards }: { cards: readonly AdminHomeCard[] }) {
  const actionable = cards.filter((card) => card.count > 0)

  if (actionable.length === 0) {
    return (
      <h2 className="mt-6 text-heading-sm text-muted-foreground">
        Nothing needs you right now.
      </h2>
    )
  }

  return (
    <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {actionable.map((card) => (
        <li key={card.id} className="flex">
          <Link
            href={card.href}
            className="flex min-h-11 w-full items-center rounded-lg bg-card p-card-padding text-heading-sm text-navy shadow-card hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {`${card.label} (${card.count})`}
          </Link>
        </li>
      ))}
    </ul>
  )
}
