"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"

/** Focuses the element with this id, if it is on the page. */
export function focusTarget(id: string) {
  document.getElementById(id)?.focus()
}

/**
 * However its buttons go away (a saved command, or a refresh after a refused
 * one that shows the task has moved on, or that took the whole queue row
 * away), focus on one of them moves to the target rather than falling to the
 * page. Layout-effect cleanup runs before React removes the DOM nodes, so
 * focus is still here. `display: contents` leaves the buttons in the row's
 * flex layout. TaskReview's buttons and TaskManage's Delete use it.
 */
export function KeepFocusOnTarget({
  targetId,
  children,
}: {
  targetId: string
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement)) focusTarget(targetId)
    }
  }, [targetId])

  return (
    <div ref={rootRef} className="contents">
      {children}
    </div>
  )
}
