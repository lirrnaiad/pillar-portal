import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getCurrentMember } from "@/features/members"

import { MemberShell } from "./member-shell"
import { NoticeToast } from "./notice-toast"

// Member routes need an active member. Signed-out and pending callers go to
// /login. This is routing only: RLS decides what any caller can read (AD-7).
// Reading the session cookies makes every page under here dynamic.
export default async function MemberLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await getCurrentMember()
  if (!member || member.role === "pending") redirect("/login")

  return (
    <MemberShell member={member}>
      <Suspense fallback={null}>
        <NoticeToast />
      </Suspense>
      {children}
    </MemberShell>
  )
}
