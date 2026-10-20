"use client"

import { useId, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { approveMemberAction, declineMemberAction } from "../actions"
import { memberErrorMessage } from "../errors"
import type { PositionGroup } from "../position-groups"
import type { PendingMember } from "../queries"

// Shown while a command saves: the tasks slice's PENDING_STYLE, restated,
// since a slice imports no other slice's components (AD-2). The controls stay
// focusable (`aria-disabled`, not `disabled`, which would drop focus to the
// page) and ignore input instead.
const PENDING_STYLE =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50"

type DialogKind = "look-alike" | "decline"

// The attribute (set to the card's id) on the card's portaled popups, the
// confirmation dialog and the primary select's list, which render outside its
// root.
const CARD_OWNER = "data-card-owner"

/** Whether `element` is inside one of the card's portaled popups. */
function isInPopupOf(element: Element | null, cardId: string): boolean {
  return (
    element?.closest(`[${CARD_OWNER}]`)?.getAttribute(CARD_OWNER) === cardId
  )
}

function isOnPage(element: Element | null): boolean {
  return element === null || element === document.body
}

/**
 * One member awaiting approval on /admin/members (Story 2.2): their name,
 * email and first sign-in, **Pick positions** and **Decline**.
 *
 * Pick positions reveals the offered positions, one fieldset per group. One
 * checked position is primary by itself; with two or more, a "Primary
 * position" select lists the checked ones, and **Approve** stays disabled
 * until one of them is chosen (again if the chosen one is unchecked). When the
 * member may be a second account of an active one (`lookAlikeName`, matched
 * on the server), Approve asks first; Decline always does. Both confirmations
 * are one AlertDialog.
 *
 * The commands run through useCommand: a refusal toasts its copy (the stale
 * line when another admin acted first) and re-reads the page. Nothing changes
 * on screen until the database has the answer; on success the row leaves the
 * list on revalidation, so focus moves first to `focusTargetId` (the
 * "Awaiting approval" heading) if it is still in this card, its popups or
 * on the page itself (an admin who has moved on to another card keeps their
 * place), and to the heading too whenever the card goes away with focus
 * inside.
 */
export function PendingMemberCard({
  member,
  positionGroups,
  focusTargetId,
}: {
  member: PendingMember
  positionGroups: readonly PositionGroup[]
  focusTargetId: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: memberErrorMessage,
    thrownCode: "members.save_failed",
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [checked, setChecked] = useState<readonly string[]>([])
  const [chosenPrimary, setChosenPrimary] = useState<string | null>(null)
  const [primarySelectOpen, setPrimarySelectOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<DialogKind>("decline")
  const [dialogOpen, setDialogOpen] = useState(false)
  const rootRef = useRef<HTMLLIElement>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const declineRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const pickerId = `${id}-picker`
  const primaryId = `${id}-primary`

  // The checked positions in the picker's order, whatever order they were
  // checked in.
  const checkedPositions = positionGroups
    .flatMap((group) => group.positions)
    .filter((position) => checked.includes(position.id))
  const primary =
    checkedPositions.length === 1
      ? checkedPositions[0].id
      : (checkedPositions.find((position) => position.id === chosenPrimary)
          ?.id ?? null)

  // However the card goes away (approved, declined, or gone in a re-read
  // after a refusal), focus inside it, or in one of its popups (portaled
  // outside it), moves to the heading rather than falling to the page.
  // Layout-effect cleanup runs before React removes the DOM nodes, so focus
  // is still here. An open popup traps focus (Radix's FocusScope pulls it
  // back while its nodes are attached), so from a popup the move waits for a
  // microtask, once the commit has removed them and focus has fallen to the
  // page.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      const active = document.activeElement
      const focusHeading = () => document.getElementById(focusTargetId)?.focus()
      if (active !== null && root?.contains(active)) {
        focusHeading()
      } else if (isInPopupOf(active, id)) {
        queueMicrotask(() => {
          if (isOnPage(document.activeElement)) focusHeading()
        })
      }
    }
  }, [focusTargetId, id])

  // After a success, before revalidation takes the card away. Focus that has
  // moved on to another card or control stays where it is.
  function focusHeadingIfHere() {
    const active = document.activeElement
    if (
      isOnPage(active) ||
      (active !== null && rootRef.current?.contains(active)) ||
      isInPopupOf(active, id)
    ) {
      document.getElementById(focusTargetId)?.focus()
    }
  }

  function togglePicker() {
    if (isPending) return
    setPickerOpen((open) => !open)
  }

  function setPositionChecked(positionId: string, next: boolean) {
    if (isPending) return
    setChecked((current) =>
      next
        ? current.includes(positionId)
          ? current
          : [...current, positionId]
        : current.filter((held) => held !== positionId)
    )
    if (!next && chosenPrimary === positionId) setChosenPrimary(null)
  }

  function openDialog(kind: DialogKind) {
    setDialogKind(kind)
    setDialogOpen(true)
  }

  function requestApprove() {
    if (isPending || primary === null) return
    if (member.lookAlikeName !== null) {
      openDialog("look-alike")
      return
    }
    approve()
  }

  function approve() {
    if (primary === null) return
    const positions = checkedPositions.map((position) => position.id)
    run(
      () =>
        approveMemberAction({
          memberId: member.id,
          positions,
          primaryPosition: primary,
        }),
      {
        onSuccess: () => {
          focusHeadingIfHere()
          toast.success(`${member.name} approved.`)
        },
      }
    )
  }

  function requestDecline() {
    if (isPending) return
    openDialog("decline")
  }

  function decline() {
    run(() => declineMemberAction({ memberId: member.id }), {
      onSuccess: () => {
        focusHeadingIfHere()
        toast.success(`${member.name} declined.`)
      },
    })
  }

  const pending = isPending || undefined

  return (
    <li ref={rootRef} className="rounded-lg bg-card p-card-padding shadow-card">
      <h3 className="font-semibold break-words">{member.name}</h3>
      <p className="text-sm break-all text-muted-foreground">{member.email}</p>
      <p className="text-sm text-muted-foreground">
        Signed in{" "}
        <time dateTime={member.signedInAt}>{member.signedInLabel}</time>
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          aria-disabled={pending}
          onClick={togglePicker}
        >
          Pick positions<span className="sr-only">, {member.name}</span>
        </Button>
        <Button
          ref={declineRef}
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={pending}
          onClick={requestDecline}
        >
          Decline<span className="sr-only">, {member.name}</span>
        </Button>
      </div>

      {pickerOpen && (
        <div id={pickerId} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {positionGroups.map((group) => (
              <fieldset key={group.id} className="flex min-w-0 flex-col">
                <legend className="mb-1 text-sm font-semibold">
                  {group.label}
                </legend>
                {group.positions.map((position) => {
                  const checkboxId = `${id}-${position.id}`
                  return (
                    <div
                      key={position.id}
                      className="flex min-h-11 items-center gap-3"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked.includes(position.id)}
                        aria-disabled={pending}
                        className={PENDING_STYLE}
                        onCheckedChange={(value) =>
                          setPositionChecked(position.id, value === true)
                        }
                      />
                      <Label
                        htmlFor={checkboxId}
                        className="min-h-11 flex-1 cursor-pointer leading-snug font-normal"
                      >
                        {position.title}
                      </Label>
                    </div>
                  )
                })}
              </fieldset>
            ))}
          </div>

          {checkedPositions.length === 1 && (
            <p className="text-sm">
              Primary position: {checkedPositions[0].title}
            </p>
          )}
          {checkedPositions.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={primaryId}>Primary position</Label>
              <Select
                value={primary ?? ""}
                open={primarySelectOpen}
                onOpenChange={(next) =>
                  setPrimarySelectOpen(next && !isPending)
                }
                onValueChange={(value) => {
                  if (!isPending) setChosenPrimary(value)
                }}
              >
                <SelectTrigger
                  id={primaryId}
                  aria-disabled={pending}
                  className={cn("min-h-11 w-full sm:w-80", PENDING_STYLE)}
                >
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent data-card-owner={id}>
                  {checkedPositions.map((position) => (
                    <SelectItem
                      key={position.id}
                      value={position.id}
                      className="min-h-11"
                    >
                      {position.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            ref={approveRef}
            type="button"
            className={cn("min-h-11 self-start", PENDING_STYLE)}
            disabled={primary === null}
            aria-disabled={pending}
            onClick={requestApprove}
          >
            Approve<span className="sr-only">, {member.name}</span>
          </Button>
        </div>
      )}

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent
          data-card-owner={id}
          onCloseAutoFocus={(event) => {
            // Radix returns focus to what had it before the dialog opened,
            // a tick after it closes. After a confirmed command that can be
            // later than the command's own success, which has already moved
            // focus to the heading, so focus goes back to the button only
            // if it has fallen to the page.
            event.preventDefault()
            if (isOnPage(document.activeElement)) {
              const trigger = dialogKind === "decline" ? declineRef : approveRef
              trigger.current?.focus()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogKind === "decline"
                ? `Decline ${member.name}?`
                : `This may be a second account of ${member.lookAlikeName}.`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialogKind === "decline"
                ? "They'll see Access declined if they sign in again."
                : "Approve anyway?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={dialogKind === "decline" ? decline : approve}
            >
              {dialogKind === "decline" ? "Decline" : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
