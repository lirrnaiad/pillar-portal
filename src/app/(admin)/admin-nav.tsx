"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

export type AdminNavLink = {
  label: string
  href: string
  /** Current only on `href` itself, not on the pages under it. */
  exact?: boolean
}

// EXPERIENCE.md's order is Home · Tasks · Reports · Recruitment · Members.
// Tasks came first (spec-1-5-admin-task-creation.md), Members with Story 2.2
// and Home with Story 2.3; Reports and Recruitment arrive between Tasks and
// Members in Epics 6–7. The sidebar and the tab row (admin-tabs.tsx) both
// list these.
export const ADMIN_NAV_LINKS: readonly AdminNavLink[] = [
  { label: "Home", href: "/admin", exact: true },
  { label: "Tasks", href: "/admin/tasks" },
  { label: "Members", href: "/admin/members" },
]

/**
 * Whether `link` is the current admin area: its own path, or (unless
 * `exact`) any path under it. Home is exact, since every admin path is under
 * `/admin`.
 */
export function isCurrentAdminLink(
  pathname: string,
  link: AdminNavLink
): boolean {
  if (pathname === link.href) return true
  return !link.exact && pathname.startsWith(`${link.href}/`)
}

/**
 * The admin sidebar's links (`lg` and up; below it, admin-tabs.tsx's row). A
 * client component only for `usePathname`; it imports nothing from
 * @/features/members, so admin-shell.tsx (which does) can stay a Server
 * Component.
 */
export function AdminNavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {ADMIN_NAV_LINKS.map((link) => {
        const current = isCurrentAdminLink(pathname, link)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "min-h-11 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted",
              current && "bg-muted"
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
