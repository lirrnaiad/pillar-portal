"use client"

import { PageLoadError, type PageLoadErrorProps } from "../page-load-error"

// The admin pages' error boundary. It wraps each page under (admin), not
// (admin)/layout.tsx, so a thrown page shows PageLoadError inside the admin
// shell, its header, tabs and sidebar still there.
export default function AdminPageError(props: PageLoadErrorProps) {
  return <PageLoadError {...props} />
}
