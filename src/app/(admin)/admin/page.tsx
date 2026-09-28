import { redirect } from "next/navigation"

// There's no Admin home yet (Epic 2), and Tasks is the only real admin area
// this story has (admin-nav.tsx), so the index route just forwards there.
// Reaching this page at all means the (admin) layout already let the caller
// through, i.e. they're an active editorial_admin.
export default function AdminIndexPage() {
  redirect("/admin/tasks")
}
