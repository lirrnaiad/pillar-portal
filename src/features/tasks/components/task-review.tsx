"use client"

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import {
  markDoneAction,
  reopenTaskAction,
  sendBackTaskAction,
} from "../actions"
import { taskErrorMessage } from "../errors"
import { REVISION_NOTE_MAX, taskSendBackSchema } from "../schemas"
import { PENDING_STYLE } from "./pending-style"

function focusTarget(id: string) {
  document.getElementById(id)?.focus()
}

/**
 * However its buttons go away (a saved command, or a refresh after a refused
 * one that shows the task has moved on, or that took the whole queue row
 * away), focus on one of them moves to the target rather than falling to the
 * page. Layout-effect cleanup runs before React removes the DOM nodes, so
 * focus is still here. `display: contents` leaves the buttons in the row's
 * flex layout.
 */
function KeepFocusOnTarget({
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

/**
 * The approver's review controls (Task detail, and each row of the review
 * queue), each shown only when task_capabilities offers it (AD-4): **Mark
 * done** and **Send back with note** while `canReview` (For Review),
 * **Reopen** while `canReopen` (Done).
 *
 * Send back opens a dialog for the required note; a blank one shows the
 * schema's inline error and calls nothing. Nothing changes on screen until
 * the database has the answer: on success a toast, the dialog closes and
 * focus goes to `focusTargetId` (Task detail's status, the queue's h1).
 * After Mark done or Reopen it goes there only from these buttons or the
 * page, so someone who moved on while it saved keeps their place. On a
 * refusal useCommand's toast and a refresh, with the dialog still open and
 * holding the note. If that refresh takes `canReview` away, the note stays
 * readable and Cancel works, but the dialog's Send back is inert: sending
 * again could only be refused again. If it takes the whole component away
 * (a queue row leaving), the dialog and its note go with it. While a command
 * saves, the controls stay focusable (`aria-disabled`) and ignore input, and
 * the dialog can't be dismissed.
 *
 * With `taskTitle`, Mark done and Send back with note are named for the task
 * too ("Mark done, <title>"), since a list can show them on several tasks.
 */
export function TaskReview({
  taskId,
  canReview,
  canReopen,
  focusTargetId,
  taskTitle,
}: {
  taskId: string
  canReview: boolean
  canReopen: boolean
  /** Where focus goes once a command is saved or its buttons go away. */
  focusTargetId: string
  taskTitle?: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const buttonsRef = useRef<HTMLDivElement>(null)
  const closingAfterSave = useRef(false)
  const id = useId()
  const noteId = `${id}-note`
  const noteErrorId = `${id}-note-error`

  if (!canReview && !canReopen && !dialogOpen) return null

  const pending = isPending || undefined
  const sendBackInert = isPending || !canReview
  const named = (action: string) =>
    taskTitle !== undefined ? `${action}, ${taskTitle}` : undefined
  const focusAfter = () => focusTarget(focusTargetId)

  // After Mark done or Reopen saves, focus moves only if it is still on
  // these buttons or has fallen to the page. Someone who moved on while it
  // saved (another queue row, the task form) keeps their place.
  function focusAfterSave() {
    const active = document.activeElement
    if (
      active === null ||
      active === document.body ||
      buttonsRef.current?.contains(active)
    ) {
      focusAfter()
    }
  }

  function markDone() {
    run(() => markDoneAction({ taskId }), {
      onSuccess: () => {
        focusAfterSave()
        toast.success("Marked done.")
      },
    })
  }

  function reopen() {
    run(() => reopenTaskAction({ taskId }), {
      onSuccess: () => {
        focusAfterSave()
        toast.success("Reopened.")
      },
    })
  }

  function changeOpen(next: boolean) {
    if (isPending) return
    setDialogOpen(next)
    if (!next) {
      setNote("")
      setNoteError(null)
    }
  }

  function sendBack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendBackInert) return
    const parsed = taskSendBackSchema.shape.note.safeParse(note)
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message ?? null)
      noteRef.current?.focus()
      return
    }
    setNoteError(null)
    run(() => sendBackTaskAction({ taskId, note }), {
      onSuccess: () => {
        closingAfterSave.current = true
        setDialogOpen(false)
        setNote("")
        toast.success("Sent back.")
      },
    })
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={changeOpen}>
      {(canReview || canReopen) && (
        <div ref={buttonsRef} className="mt-3 flex flex-wrap gap-3">
          {canReview && (
            <KeepFocusOnTarget targetId={focusTargetId}>
              <Button
                type="button"
                className={cn("min-h-11", PENDING_STYLE)}
                aria-label={named("Mark done")}
                aria-disabled={pending}
                onClick={markDone}
              >
                Mark done
              </Button>
              <DialogTrigger asChild>
                <Button
                  ref={triggerRef}
                  type="button"
                  variant="outline"
                  className={cn("min-h-11", PENDING_STYLE)}
                  aria-label={named("Send back with note")}
                  aria-disabled={pending}
                >
                  Send back with note
                </Button>
              </DialogTrigger>
            </KeepFocusOnTarget>
          )}
          {canReopen && (
            <KeepFocusOnTarget targetId={focusTargetId}>
              <Button
                type="button"
                variant="outline"
                className={cn("min-h-11", PENDING_STYLE)}
                aria-disabled={pending}
                onClick={reopen}
              >
                Reopen
              </Button>
            </KeepFocusOnTarget>
          )}
        </div>
      )}

      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          // After a save, or once a refresh has taken the trigger away,
          // focus goes to the target instead of back to the trigger.
          if (closingAfterSave.current || !triggerRef.current?.isConnected) {
            event.preventDefault()
            closingAfterSave.current = false
            focusAfter()
          }
        }}
      >
        <form noValidate className="grid gap-4" onSubmit={sendBack}>
          <DialogHeader>
            <DialogTitle>Send back with note</DialogTitle>
          </DialogHeader>
          <Field data-invalid={noteError !== null || undefined}>
            <FieldLabel htmlFor={noteId}>Note</FieldLabel>
            <Textarea
              ref={noteRef}
              id={noteId}
              value={note}
              maxLength={REVISION_NOTE_MAX}
              aria-invalid={noteError !== null}
              aria-describedby={noteError !== null ? noteErrorId : undefined}
              aria-disabled={pending}
              readOnly={isPending}
              className={cn("min-h-24", PENDING_STYLE)}
              onChange={(event) => {
                setNote(event.target.value)
                setNoteError(null)
              }}
            />
            {noteError !== null && (
              <FieldError id={noteErrorId}>{noteError}</FieldError>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className={cn("min-h-11", PENDING_STYLE)}
              aria-disabled={pending}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={cn("min-h-11", PENDING_STYLE)}
              aria-disabled={sendBackInert || undefined}
            >
              Send back
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
