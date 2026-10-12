import { Suspense } from "react"

import { requireActiveMember } from "@/features/members"

import { MemberShell } from "./member-shell"
import { NoticeToast } from "./notice-toast"

// Member routes need an active member: requireActiveMember sends anyone else
// (signed out, pending, declined, deactivated) to /login. Each page makes the
// same check first, since a layout doesn't stop its page rendering. This is
// routing only: RLS decides what any caller can read (AD-7). Reading the
// session cookies makes every page under here dynamic.
export default async function MemberLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await requireActiveMember()

  return (
    <MemberShell member={member}>
      <Suspense fallback={null}>
        <NoticeToast />
      </Suspense>
      {children}
    </MemberShell>
  )
}
