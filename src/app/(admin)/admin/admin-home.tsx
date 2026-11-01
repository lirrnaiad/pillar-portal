import Link from "next/link"

/** One row of a list card's preview, its text already built. */
export type AdminHomeRow = {
  id: string
  text: string
  /** Shown under the row as "Reason: <reason>" when given. */
  reason: string | null
}

/** One Admin home card's data: a count already read for the viewer. */
export type AdminHomeCard = {
  id: string
  label: string
  href: string
  count: number
  /**
   * Makes it a list card: the first rows under its heading and a link with
   * this label to `href`, in place of the one link.
   */
  preview?: { rows: readonly AdminHomeRow[]; linkLabel: string }
}

/** A list card shows at most this many rows; its heading counts them all. */
export const ADMIN_HOME_PREVIEW_ROWS = 5

/**
 * Admin home's count cards (Story 2.3): only what the admin can act on, so a
 * card shows only while its count is above 0, as "<label> (<n>)" in text
 * (never color alone), the whole card one link to where the work is. A list
 * card (Story 3.8) instead heads its first rows with that text and ends in a
 * link. Each card keeps its own height (`items-start`), so a link card beside
 * a taller list card doesn't grow into a large, mostly empty link. With
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
    <ul className="mt-6 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {actionable.map((card) => (
        <li key={card.id} className="flex">
          {card.preview === undefined ? (
            <Link
              href={card.href}
              className="flex min-h-11 w-full items-center rounded-lg bg-card p-card-padding text-heading-sm text-navy shadow-card hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            >
              {`${card.label} (${card.count})`}
            </Link>
          ) : (
            <AdminHomeListCard card={card} preview={card.preview} />
          )}
        </li>
      ))}
    </ul>
  )
}

function AdminHomeListCard({
  card,
  preview,
}: {
  card: AdminHomeCard
  preview: NonNullable<AdminHomeCard["preview"]>
}) {
  return (
    <div className="flex w-full min-w-0 flex-col rounded-lg bg-card p-card-padding shadow-card">
      <h2 className="text-heading-sm text-navy">
        {`${card.label} (${card.count})`}
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {preview.rows.slice(0, ADMIN_HOME_PREVIEW_ROWS).map((row) => (
          <li key={row.id} className="break-words">
            <p>{row.text}</p>
            {row.reason !== null && (
              <p className="text-muted-foreground">Reason: {row.reason}</p>
            )}
          </li>
        ))}
      </ul>
      <Link
        href={card.href}
        className="mt-1 inline-flex min-h-11 items-center self-start rounded-sm text-navy underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        {preview.linkLabel}
      </Link>
    </div>
  )
}
