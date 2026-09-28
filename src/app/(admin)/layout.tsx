import { redirect } from "next/navigation"

import { getCurrentMember } from "@/features/members"

import { AdminShell } from "./admin-shell"

// Admin routes need an active editorial_admin. Signed-out and pending
// callers go to /login, same as the member layout; an active staff member
// goes back to /dashboard with the notice the (member) layout's toast reader
// shows. This is routing only: RLS and create_task still decide access
// (spec-1-5-admin-task-creation.md).
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await getCurrentMember()
  if (!member || member.role === "pending") redirect("/login")
  if (member.role === "staff") redirect("/dashboard?notice=admin-restricted")

  return <AdminShell member={member}>{children}</AdminShell>
}
