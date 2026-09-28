import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

// Navy can't show on the navy header and gold is never a focus ring, so
// header controls get a white outline instead of the navy ring (DESIGN.md).
// No `outline-none` with it: in Tailwind 4 that sets the outline style to
// none, which `outline-2` then inherits.
export const HEADER_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"

/**
 * The app header (DESIGN.md › App header): a navy bar with the logo and the
 * wordmark at left, the 3px brand-gold rule along the bottom, and `children`
 * (such as the avatar menu) at right. With `homeHref`, the logo and wordmark
 * link there.
 */
export function AppHeader({
  homeHref,
  children,
}: {
  homeHref?: string
  children?: React.ReactNode
}) {
  const brand = (
    <>
      <Image
        src="/thepillar-logo.png"
        alt=""
        width={34}
        height={34}
        loading="eager"
      />
      <span className="font-heading text-heading uppercase">The Pillar</span>
    </>
  )

  return (
    <header className="border-b-3 border-brand-gold bg-navy text-white">
      <div className="mx-auto flex min-h-14 w-full max-w-160 items-center justify-between gap-4 px-page-margin-mobile md:px-page-margin-desktop">
        {homeHref ? (
          <Link
            href={homeHref}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-sm",
              HEADER_FOCUS
            )}
          >
            {brand}
          </Link>
        ) : (
          <div className="flex min-h-11 items-center gap-2.5">{brand}</div>
        )}
        {children}
      </div>
    </header>
  )
}
