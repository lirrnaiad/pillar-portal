import { AppHeader } from "@/components/app-header"
import { type CurrentMember, MemberMenu } from "@/features/members"

import { DashboardTabs } from "./dashboard-tabs"

/**
 * The member layout's chrome: the app header with the avatar menu and the
 * view tabs, then the page in a single column capped at 640px
 * (EXPERIENCE.md › Responsive).
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
      <main className="mx-auto w-full max-w-160 px-page-margin-mobile py-8 md:px-page-margin-desktop">
        {children}
      </main>
    </>
  )
}
