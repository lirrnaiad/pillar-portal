import Link from "next/link"

/**
 * What Task detail and the edit page show for a malformed id, a missing or
 * deleted task, and one the caller can't read: they all look the same.
 */
export function TaskNotFound() {
  return (
    <>
      <h1 className="font-heading text-heading text-navy">
        This task was deleted or the link is wrong.
      </h1>
      <p className="mt-4">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center text-navy underline underline-offset-4 hover:no-underline"
        >
          Back to What&apos;s mine
        </Link>
      </p>
    </>
  )
}
