import { AppHeader } from "@/components/app-header"
import { MemberMenu, type CurrentMember } from "@/features/members"

import { AdminNavLinks } from "./admin-nav"
import { AdminTabs } from "./admin-tabs"

/**
 * The admin shell (DESIGN.md › Admin routes): the app header widened up to
 * 1440px, its logo linking to Admin home, with the avatar menu ("My
 * dashboard", back to the member side, and Sign out) and, below `lg`, the
 * admin tab row in its `nav` slot; then the banner slot (`banners`, the
 * layout's AdminBannerSlot) between the header and the content; then a left
 * sidebar nav on `lg` and up beside `<main>`. The sidebar and the tab row are
 * two navs, one per breakpoint, with distinct names.
 *
 * A Server Component on purpose, unlike member-shell.tsx's sibling only in
 * spirit: it imports MemberMenu through @/features/members, whose barrel
 * also carries queries.ts's "server-only" import. Bundling that into a
 * Client Component fails the build, so the pieces that genuinely need
 * `usePathname` (the sidebar and the tab row) live in their own client
 * components that import nothing from @/features/members.
 */
export function AdminShell({
  member,
  banners,
  children,
}: {
  member: Pick<CurrentMember, "name">
  banners?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      <AppHeader
        homeHref="/admin"
        className="max-w-[1440px]"
        nav={<AdminTabs />}
      >
        <MemberMenu
          name={member.name}
          extraLinks={[{ label: "My dashboard", href: "/dashboard" }]}
        />
      </AppHeader>
      {banners}
      <div className="mx-auto flex w-full max-w-[1440px] gap-8 px-page-margin-mobile py-8 md:px-page-margin-desktop">
        <aside className="hidden w-48 shrink-0 lg:block">
          <AdminNavLinks />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  )
}
