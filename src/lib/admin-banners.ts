/**
 * An admin banner (EXPERIENCE.md › Admin banner; DESIGN.md › Admin banner):
 * one full-width bar under the header on every admin page. The type lives
 * here, outside src/app, so a slice's banner source can return it; the
 * sources themselves are listed in src/app/(admin)/admin-banner-sources.ts.
 */
export type AdminBanner = {
  /** Unique among the banners shown, and stable: the tiebreak after `since`. */
  id: string
  /** The dot's status family: attention (stopped, stale, overdue) or
   * progress (scheduled). Color stays in the dot; the text says it all. */
  family: "attention" | "progress"
  text: string
  /** When the condition began, as an ISO 8601 instant. Oldest shows first;
   * one that doesn't parse counts as the newest. */
  since: string
  /**
   * The Server Action behind the bar's outline Cancel, bound by the owning
   * story to whatever it cancels. Omitted, the bar has no Cancel. It must be
   * a Server Action exported from a "use server" module: a plain function
   * can't be serialized into the form and breaks the layout's render. It must
   * also `revalidatePath("/admin", "layout")`, so the bar goes away once the
   * thing is canceled. A pending state, a confirmation or a two-factor
   * step-up are the owning story's to add when it needs them.
   */
  cancel?: (formData: FormData) => void | Promise<void>
}

export const MAX_ADMIN_BANNERS = 3

const FAMILY_ORDER: Record<AdminBanner["family"], number> = {
  attention: 0,
  progress: 1,
}

// `since` as a sortable number. One that doesn't parse would make every
// comparison with it NaN, and the sort inconsistent, so it counts as the
// newest: last in its family, then by id.
function sinceOrder(since: string): number {
  const time = Date.parse(since)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

function compareSince(a: AdminBanner, b: AdminBanner): number {
  const left = sinceOrder(a.since)
  const right = sinceOrder(b.since)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The banners to show: attention before progress, then the oldest `since`
 * first (an unparseable one last), then by id, at most MAX_ADMIN_BANNERS of
 * them. The input is left as it was.
 */
export function visibleAdminBanners(
  banners: readonly AdminBanner[]
): AdminBanner[] {
  return [...banners]
    .sort(
      (a, b) =>
        FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] ||
        compareSince(a, b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .slice(0, MAX_ADMIN_BANNERS)
}
