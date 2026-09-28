import { AppHeader } from "@/components/app-header"
import { MemberMenu, type CurrentMember } from "@/features/members"

import { AdminMobileNav } from "./admin-mobile-nav"
import { AdminNavLinks } from "./admin-nav"

/**
 * The admin shell (DESIGN.md › Admin routes): the app header widened up to
 * 1440px, a left sidebar nav on `lg` and up, a `Sheet` below it. "My
 * dashboard" (back to the member side) and Sign out live in the avatar menu.
 *
 * A Server Component on purpose, unlike member-shell.tsx's sibling only in
 * spirit: it imports MemberMenu through @/features/members, whose barrel
 * also carries queries.ts's "server-only" import. Bundling that into a
 * Client Component fails the build, so the pieces that genuinely need
 * `usePathname`/`useState` (the sidebar and mobile nav) live in their own
 * client components that import nothing from @/features/members.
 */
export function AdminShell({
  member,
  children,
}: {
  member: Pick<CurrentMember, "name">
  children: React.ReactNode
}) {
  return (
    <>
      <AppHeader homeHref="/admin/tasks" className="max-w-[1440px]">
        <div className="flex items-center gap-2">
          <AdminMobileNav />
          <MemberMenu
            name={member.name}
            extraLinks={[{ label: "My dashboard", href: "/dashboard" }]}
          />
        </div>
      </AppHeader>
      <div className="mx-auto flex w-full max-w-[1440px] gap-8 px-page-margin-mobile py-8 md:px-page-margin-desktop">
        <aside className="hidden w-48 shrink-0 lg:block">
          <AdminNavLinks />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  )
}
