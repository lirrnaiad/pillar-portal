import { cn } from "@/lib/utils"

// Only these schemes may become a link. Anything else a stored URL could
// hold (`javascript:`, `data:`, a relative path) renders as plain text.
const SAFE_PROTOCOLS = new Set(["http:", "https:"])

function safeHref(href: string): string | null {
  try {
    const url = new URL(href)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/**
 * The one way a stored URL (a task's reference link, and later ones) reaches
 * the page as a link: an absolute http(s) URL opens in a new tab without
 * handing it `window.opener` or a referrer; anything else is shown as text.
 * The link carries the URL as parsed, so what was checked is what's linked.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  const url = safeHref(href)

  if (url === null) {
    return <span className={className}>{children}</span>
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-navy underline underline-offset-4 hover:no-underline",
        className
      )}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
