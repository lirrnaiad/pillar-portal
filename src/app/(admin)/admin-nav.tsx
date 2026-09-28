"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// Only Tasks is a real link this story (spec-1-5-admin-task-creation.md);
// later stories add Reports, Recruitment and Members here.
const NAV_LINKS = [{ label: "Tasks", href: "/admin/tasks" }]

/**
 * The admin nav's links, shared by the sidebar (`lg` and up) and the mobile
 * Sheet (admin-mobile-nav.tsx). A client component only for `usePathname`;
 * it imports nothing from @/features/members, so admin-shell.tsx (which
 * does) can stay a Server Component.
 */
export function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {NAV_LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-h-11 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted",
              active && "bg-muted"
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
