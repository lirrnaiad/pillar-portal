import { Suspense } from "react"

import { NoticeToast } from "../notice-toast"
import { AdminBannerSlot } from "./admin-banners"
import { AdminShell } from "./admin-shell"
import { requireAdmin } from "./require-admin"

// Admin routes need an active editorial_admin (requireAdmin): anyone not
// active goes to /login, an active staff member back to /dashboard with a
// notice. Each page makes the same check first, since a layout doesn't stop
// its page rendering. This is routing only: RLS and create_task still decide
// access (spec-1-5-admin-task-creation.md). The banner slot reads its sources
// only after the check, whenever the layout renders. The notice-toast reader
// shows a `?notice=` a command's navigation set, such as Task detail's
// Delete landing on /admin/tasks.
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await requireAdmin()

  return (
    <AdminShell member={member} banners={<AdminBannerSlot />}>
      <Suspense fallback={null}>
        <NoticeToast />
      </Suspense>
      {children}
    </AdminShell>
  )
}
