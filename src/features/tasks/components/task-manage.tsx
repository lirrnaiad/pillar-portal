"use client"

import { useRef, useState, type MouseEvent } from "react"
import { useRouter } from "next/navigation"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { deleteTaskAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { focusTarget, KeepFocusOnTarget } from "./keep-focus-on-target"
import { PENDING_STYLE } from "./pending-style"

// Where the approver lands after a delete: /admin/tasks, whose NoticeToast
// shows "Task deleted." and focuses the page's h1.
const AFTER_DELETE_HREF = "/admin/tasks?notice=task-deleted"

/**
 * The approver's manage row on Task detail, under TaskReview, shown only
 * while task_capabilities offers `canManage` (AD-4): **Delete** (Story 3.7
 * puts **Edit** before it).
 *
 * Delete asks first. The confirmation passes the version the page was
 * rendered from (`expectedUpdatedAt`, AD-21), so a task that changed since
 * is refused as stale rather than deleted unseen. Cancel calls nothing and
 * focus returns to Delete. Nothing changes on screen until the database has
 * the answer: on success the approver goes to /admin/tasks, which replaces
 * Task detail in the history, so Back skips the deleted task; on a refusal
 * useCommand's toast and a refresh, and the dialog closes. If that refresh
 * takes the row away, focus on it moves to `focusTargetId` (Task detail's
 * status). While the delete saves, and while the page leaves after it, the
 * buttons stay focusable (`aria-disabled`) and ignore input, and the dialog
 * can't be dismissed.
 */
export function TaskManage({
  taskId,
  taskTitle,
  expectedUpdatedAt,
  canManage,
  focusTargetId,
}: {
  taskId: string
  taskTitle: string
  /** The task's `updated_at`, exactly as PostgREST returned it. */
  expectedUpdatedAt: string
  canManage: boolean
  /** Where focus goes if the row goes away with focus on it. */
  focusTargetId: string
}) {
  const router = useRouter()
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  // Set once the delete is saved, so nothing reopens or resends it while
  // the page leaves.
  const [leaving, setLeaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (!canManage && !dialogOpen) return null

  const busy = isPending || leaving
  const pending = busy || undefined

  function changeOpen(next: boolean) {
    if (busy) return
    setDialogOpen(next)
  }

  function confirmDelete(event: MouseEvent<HTMLButtonElement>) {
    // AlertDialogAction would close the dialog; it stays open while the
    // delete saves.
    event.preventDefault()
    if (busy) return
    run(() => deleteTaskAction({ taskId, expectedUpdatedAt }), {
      onSuccess: () => {
        setLeaving(true)
        // Replace, not push: Back can't return to the deleted task's entry
        // and its cached page.
        router.replace(AFTER_DELETE_HREF)
      },
      onFailure: () => setDialogOpen(false),
    })
  }

  return (
    <AlertDialog open={dialogOpen} onOpenChange={changeOpen}>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-3">
          <KeepFocusOnTarget targetId={focusTargetId}>
            <AlertDialogTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                variant="outline"
                className={cn("min-h-11", PENDING_STYLE)}
                aria-disabled={pending}
              >
                Delete
              </Button>
            </AlertDialogTrigger>
          </KeepFocusOnTarget>
        </div>
      )}

      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // Once a refresh has taken Delete away, focus goes to the target
          // instead of falling to the page.
          if (!triggerRef.current?.isConnected) {
            event.preventDefault()
            focusTarget(focusTargetId)
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            {`Delete "${taskTitle}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {"Everyone loses access to it, and this can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className={cn("min-h-11", PENDING_STYLE)}
            aria-disabled={pending}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={cn("min-h-11", PENDING_STYLE)}
            aria-disabled={pending}
            onClick={confirmDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
