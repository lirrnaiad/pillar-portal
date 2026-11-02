"use client"

import { useId, useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { clientEnv } from "@/lib/env.client"
import { PENDING_STYLE } from "@/lib/pending-style"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { reassignSlotAction } from "../actions"
import { taskErrorMessage, type TaskErrorCode } from "../errors"
import { buildMessengerMessage } from "../messenger"
import type { ReassignOptions } from "../queries/reassign"
import {
  buildReassignList,
  duplicateSlotMessage,
  REASSIGN_EMPTY_DESK,
  reassignedMessage,
  reassignRowLabel,
  type ReassignMember,
} from "../reassign"
import type { PRODUCTION_ROLES } from "../schemas"
import { focusTarget, KeepFocusOnTarget } from "./keep-focus-on-target"
import { copyForMessengerAction } from "./messenger-toast"

type ProductionRole = (typeof PRODUCTION_ROLES)[number]

/**
 * **Reassign** on one slot (Task detail renders it on each slot only while
 * task_capabilities offers `canReassign`, AD-4). It opens a picker listing
 * the role's desk as "<name> · <n> active", lowest load first; **Show
 * everyone** widens it, and an empty desk lists everyone. The slot's own
 * member is listed while active, marked "(current)": picking them resets the
 * slot.
 *
 * Nothing changes on screen until the database has the answer. The picker
 * passes the slot's version as it was when the picker opened
 * (`expectedUpdatedAt` then, AD-21), so a refresh while it is open (after a
 * refused pair, say) can't move the version past an answer the approver
 * never saw. On success the dialog closes and a toast names the new member,
 * with Copy for Messenger for this slot's role. On a refusal useCommand's
 * toast and a refresh: a repeated pair names the member picked and keeps
 * the dialog open with the choice cleared; any other refusal closes it.
 * While it saves, the buttons stay focusable (`aria-disabled`) and ignore
 * input, and the dialog can't be dismissed. Focus returns to Reassign, or to
 * `focusTargetId` (the slot's row) once Reassign is gone, or to
 * `fallbackFocusTargetId` (Task detail's status) once the row is gone too.
 */
export function ReassignSlot({
  taskId,
  taskTitle,
  taskDueAt,
  slotId,
  role,
  memberId,
  memberName,
  stateLabel,
  expectedUpdatedAt,
  options,
  focusTargetId,
  fallbackFocusTargetId,
  namedForTask = false,
}: {
  taskId: string
  taskTitle: string
  /** UTC ISO timestamp, for the Messenger message. */
  taskDueAt: string
  slotId: string
  role: ProductionRole
  /** The slot's member now. */
  memberId: string
  /** As Task detail shows them ("Former member" once they've left). */
  memberName: string
  /** The slot's state, as Task detail labels it. */
  stateLabel: string
  /** The slot's `updated_at`, exactly as PostgREST returned it. */
  expectedUpdatedAt: string
  options: ReassignOptions
  /** Where focus goes if Reassign goes away. */
  focusTargetId: string
  /** Where focus goes if `focusTargetId` isn't on the page either. */
  fallbackFocusTargetId?: string
  /**
   * Appends ", <task title>" to Reassign's sr-only name, for a list that can
   * hold the same role on several tasks (the Needs reassignment queue).
   * Task detail leaves it off.
   */
  namedForTask?: boolean
}) {
  // The member a save was sent for, so a refused pair names them.
  const pickedRef = useRef<ReassignMember | null>(null)
  const { isPending, run } = useCommand({
    errorMessage: (code: TaskErrorCode) =>
      code === "tasks.duplicate_slot" && pickedRef.current !== null
        ? duplicateSlotMessage(pickedRef.current.name)
        : taskErrorMessage(code),
    thrownCode: "tasks.save_failed",
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  // The slot's version when the picker opened: what a save passes, whatever
  // a refresh brings meanwhile.
  const [openedVersion, setOpenedVersion] = useState(expectedUpdatedAt)
  const [choice, setChoice] = useState<string | null>(null)
  const [showEveryone, setShowEveryone] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const emptyDeskId = `${id}-empty-desk`

  const roleLabel = options.roleLabels[role]
  const listFor = (everyone: boolean) =>
    buildReassignList({
      deskMembers: options.slotMembersByRole[role] ?? [],
      allMembers: options.allMembers,
      currentMemberId: memberId,
      showEveryone: everyone,
    })
  const list = listFor(showEveryone)
  // A choice the list no longer shows (Show everyone unchecked, or a
  // refresh) is no choice.
  const chosen = list.rows.find((row) => row.id === choice) ?? null
  const pending = isPending || undefined

  function reset() {
    setChoice(null)
    setShowEveryone(false)
  }

  function changeOpen(next: boolean) {
    if (isPending) return
    setDialogOpen(next)
    if (next) setOpenedVersion(expectedUpdatedAt)
    else reset()
  }

  function changeShowEveryone(next: boolean) {
    if (isPending) return
    setShowEveryone(next)
    // Narrowing forgets a choice the desk list doesn't show, so checking
    // Show everyone again doesn't bring it back unpicked.
    if (!next && !listFor(false).rows.some((row) => row.id === choice)) {
      setChoice(null)
    }
  }

  function messengerText() {
    return buildMessengerMessage(
      { id: taskId, title: taskTitle, roles: [role], dueAt: taskDueAt },
      clientEnv.NEXT_PUBLIC_SITE_URL,
      options.roleLabels
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending || chosen === null) return
    const picked = chosen
    pickedRef.current = picked
    run(
      () =>
        reassignSlotAction({
          slotId,
          memberId: picked.id,
          expectedUpdatedAt: openedVersion,
        }),
      {
        onSuccess: () => {
          setDialogOpen(false)
          reset()
          toast.success(
            reassignedMessage(picked.name),
            copyForMessengerAction(messengerText())
          )
        },
        onFailure: (code) => {
          if (code === "tasks.duplicate_slot") {
            // Pick again: Reassign is disabled until then, so focus goes
            // to the list.
            setChoice(null)
            listRef.current
              ?.querySelector<HTMLInputElement>("input[type=radio]")
              ?.focus()
            return
          }
          setDialogOpen(false)
          reset()
        },
      }
    )
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={changeOpen}>
      <KeepFocusOnTarget
        targetId={focusTargetId}
        fallbackId={fallbackFocusTargetId}
      >
        <DialogTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            className={cn("min-h-11", PENDING_STYLE)}
            aria-disabled={pending}
          >
            Reassign
            <span className="sr-only">
              {` (${roleLabel})${namedForTask ? `, ${taskTitle}` : ""}`}
            </span>
          </Button>
        </DialogTrigger>
      </KeepFocusOnTarget>

      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          // Once a refresh has taken Reassign away, focus goes to the slot's
          // row (or, with the row gone too, the fallback) instead of falling
          // to the page.
          if (!triggerRef.current?.isConnected) {
            event.preventDefault()
            focusTarget(focusTargetId, fallbackFocusTargetId)
          }
        }}
      >
        <form noValidate className="grid min-w-0 gap-4" onSubmit={submit}>
          <DialogHeader>
            {/* Radix names the dialog with DialogTitle's own id, so the
                list's label points at this span instead. */}
            <DialogTitle className="break-words">
              <span id={titleId}>{`Reassign ${roleLabel}`}</span>
            </DialogTitle>
            <DialogDescription className="break-words">
              {`${memberName} · ${stateLabel}`}
            </DialogDescription>
          </DialogHeader>
          {list.emptyDesk && (
            <p id={emptyDeskId} className="text-sm text-muted-foreground">
              {REASSIGN_EMPTY_DESK}
            </p>
          )}
          <div
            ref={listRef}
            role="radiogroup"
            aria-labelledby={titleId}
            aria-describedby={list.emptyDesk ? emptyDeskId : undefined}
            className="-mx-1 max-h-[min(50vh,20rem)] overflow-y-auto px-1"
          >
            {list.rows.map((row) => (
              <label
                key={row.id}
                className="flex min-h-11 cursor-pointer items-center gap-3"
              >
                <input
                  type="radio"
                  name={`${id}-member`}
                  value={row.id}
                  checked={choice === row.id}
                  aria-disabled={pending}
                  className="size-4 shrink-0"
                  onChange={() => {
                    if (!isPending) setChoice(row.id)
                  }}
                />
                <span className="min-w-0 break-words">
                  {reassignRowLabel(row)}
                </span>
              </label>
            ))}
          </div>
          {list.canShowEveryone && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showEveryone}
                aria-disabled={pending}
                onChange={(event) => changeShowEveryone(event.target.checked)}
              />
              Show everyone
            </label>
          )}
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
              disabled={chosen === null}
              aria-disabled={pending}
            >
              Reassign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
