import { type RefObject, useLayoutEffect } from "react"

// The attribute a component sets, to its `popupOwnerId`, on each popup it
// portals outside its root (a dialog's content, a select's list):
// `data-popup-owner={popupOwnerId}`.
const POPUP_OWNER = "data-popup-owner"

/** Whether `element` is inside one of the popups `ownerId` owns. */
export function isInPopupOf(element: Element | null, ownerId: string): boolean {
  return (
    element?.closest(`[${POPUP_OWNER}]`)?.getAttribute(POPUP_OWNER) === ownerId
  )
}

/** Whether focus has fallen to the page: nothing, or the body, holds it. */
export function isOnPage(element: Element | null): boolean {
  return element === null || element === document.body
}

/**
 * However the component goes away (a saved command, or a refresh after a
 * refused one that shows it no longer applies), focus inside `rootRef` moves
 * to the element with `targetId` (which has `tabIndex={-1}`) rather than
 * falling to the page. Layout-effect cleanup runs before React removes the
 * DOM nodes, so focus is still here. Focus elsewhere stays where it is.
 *
 * With `popupOwnerId`, focus in one of the component's portaled popups
 * (marked `data-popup-owner={popupOwnerId}`, outside the root) moves too. An
 * open popup traps focus (Radix's FocusScope pulls it back while its nodes
 * are attached), so from a popup the move waits for a microtask, once the
 * commit has removed them and focus has fallen to the page.
 */
export function useFocusFallback(
  rootRef: RefObject<HTMLElement | null>,
  targetId: string,
  popupOwnerId?: string
): void {
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      const active = document.activeElement
      const focusTarget = () => document.getElementById(targetId)?.focus()
      if (active !== null && root?.contains(active)) {
        focusTarget()
      } else if (
        popupOwnerId !== undefined &&
        isInPopupOf(active, popupOwnerId)
      ) {
        queueMicrotask(() => {
          if (isOnPage(document.activeElement)) focusTarget()
        })
      }
    }
  }, [rootRef, targetId, popupOwnerId])
}
