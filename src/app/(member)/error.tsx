"use client"

import { PageLoadError, type PageLoadErrorProps } from "../page-load-error"

// The member pages' error boundary. It wraps each page under (member), not
// (member)/layout.tsx, so a thrown page shows PageLoadError under the header
// and tabs.
export default function MemberPageError(props: PageLoadErrorProps) {
  return <PageLoadError {...props} />
}
