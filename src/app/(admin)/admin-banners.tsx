import { StatusDot } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { visibleAdminBanners, type AdminBanner } from "@/lib/admin-banners"

import { ADMIN_BANNER_SOURCES } from "./admin-banner-sources"

/**
 * The admin banners (DESIGN.md › Admin banner), in the order given: each a
 * full-width `muted` bar whose row lines up with the 1440px admin content,
 * with the family's dot beside the text and, when the banner has one, an
 * outline Cancel. Cancel is a plain form posting the banner's Server Action,
 * so it works before hydration; the banner text describes it. No banners, no
 * region.
 */
export function AdminBanners({ banners }: { banners: readonly AdminBanner[] }) {
  if (banners.length === 0) return null

  return (
    <section aria-label="Notices">
      {banners.map((banner, index) => {
        const textId = `admin-banner-${index}`
        return (
          <div key={banner.id} className="border-b border-border bg-muted">
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-page-margin-mobile py-2 md:px-page-margin-desktop">
              <p
                id={textId}
                className="flex min-h-11 min-w-0 flex-1 items-center"
              >
                <StatusDot family={banner.family} label={banner.text} />
              </p>
              {banner.cancel && (
                <form action={banner.cancel}>
                  <Button
                    type="submit"
                    variant="outline"
                    aria-describedby={textId}
                    className="min-h-11 min-w-11"
                  >
                    Cancel
                  </Button>
                </form>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/**
 * The admin layout's banner slot: every source in ADMIN_BANNER_SOURCES, read
 * in parallel whenever the layout renders, then attention first, oldest
 * first, at most three.
 *
 * Banners are notices, so a failing source fails on its own: its error is
 * logged (the error only) and the banners from the sources that answered
 * still show, rather than one source taking every admin page down. (Admin
 * home's counts, by contrast, still throw to Next's error page.)
 *
 * It renders without a Suspense boundary of its own on purpose: the layout
 * waits for the sources, so a banner never pops in and shifts the page.
 */
export async function AdminBannerSlot() {
  const results = await Promise.allSettled(
    ADMIN_BANNER_SOURCES.map((source) => source())
  )
  const banners = results.flatMap((result) => {
    if (result.status === "fulfilled") return result.value
    console.error(result.reason)
    return []
  })
  return <AdminBanners banners={visibleAdminBanners(banners)} />
}
