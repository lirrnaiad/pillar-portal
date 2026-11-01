"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"

/**
 * Focuses the element with this id, if it is on the page, or else the one
 * with `fallbackId`, if given and on the page.
 */
export function focusTarget(id: string, fallbackId?: string) {
  const target =
    document.getElementById(id) ??
    (fallbackId !== undefined ? document.getElementById(fallbackId) : null)
  target?.focus()
}

/**
 * However its buttons go away (a saved command, or a refresh after a refused
 * one that shows the task has moved on, or that took the whole queue row
 * away), focus on one of them moves to the target rather than falling to the
 * page. Layout-effect cleanup runs before React removes the DOM nodes, so
 * focus is still here. `display: contents` leaves the buttons in the row's
 * flex layout. TaskReview's buttons and TaskManage's Delete use it.
 *
 * With `fallbackId`, focus goes there when the target isn't on the page,
 * including a target that leaves in the same commit as the buttons (a slot
 * row removed with its Reassign): it is still on the page during the
 * cleanup, so once the commit is done, focus that fell to the page moves to
 * the fallback.
 */
export function KeepFocusOnTarget({
  targetId,
  fallbackId,
  children,
}: {
  targetId: string
  fallbackId?: string
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (!root?.contains(document.activeElement)) return
      focusTarget(targetId, fallbackId)
      if (fallbackId === undefined) return
      queueMicrotask(() => {
        const active = document.activeElement
        if (active === null || active === document.body) {
          focusTarget(fallbackId)
        }
      })
    }
  }, [targetId, fallbackId])

  return (
    <div ref={rootRef} className="contents">
      {children}
    </div>
  )
}
