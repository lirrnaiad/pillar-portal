import { AppHeader } from "@/components/app-header"
import { type CurrentMember, MemberMenu } from "@/features/members"

import { DashboardTabs } from "./dashboard-tabs"

/**
 * The member layout's chrome: the app header with the avatar menu and the
 * view tabs, then the page in a single column capped at 640px
 * (EXPERIENCE.md › Responsive).
 *
 * The Board is the one view whose content goes wider, up to 1440px. The
 * layout can't know which view a page is, so a view that wants the width
 * renders an element with `data-wide-view`, and `<main>` widens when it
 * `:has()` one, so the cap changes with the page's own skeleton, not after it
 * loads. The header's contents stay in the 640px column on every view, so the
 * logo, tabs and avatar never move when switching tabs.
 */
export function MemberShell({
  member,
  children,
}: {
  member: Pick<CurrentMember, "name" | "role">
  children: React.ReactNode
}) {
  return (
    <>
      <AppHeader homeHref="/dashboard" nav={<DashboardTabs />}>
        <MemberMenu
          name={member.name}
          extraLinks={
            member.role === "editorial_admin"
              ? [{ label: "Admin", href: "/admin" }]
              : []
          }
        />
      </AppHeader>
      <main className="mx-auto w-full max-w-160 px-page-margin-mobile py-8 has-[[data-wide-view]]:max-w-[1440px] md:px-page-margin-desktop">
        {children}
      </main>
    </>
  )
}
