import { redirect } from "next/navigation"

import { requireActiveMember, type ActiveMember } from "@/features/members"

/**
 * The admin layout's and every admin page's first check: an active
 * editorial_admin. Anyone not active goes to /login (requireActiveMember);
 * an active staff member goes back to /dashboard with the notice the
 * (member) layout's toast reader shows. Routing only: RLS and the commands
 * still decide access (AD-7).
 */
export async function requireAdmin(): Promise<ActiveMember> {
  const member = await requireActiveMember()
  if (member.role !== "editorial_admin") {
    redirect("/dashboard?notice=admin-restricted")
  }
  return member
}
