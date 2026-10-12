import { redirect } from "next/navigation"

import { requireAdmin } from "../require-admin"

// There's no Admin home yet (Story 2.3), and Tasks is the only real admin
// area so far (admin-nav.tsx), so the index route forwards there once the
// caller passes the admin check.
export default async function AdminIndexPage() {
  await requireAdmin()
  redirect("/admin/tasks")
}
