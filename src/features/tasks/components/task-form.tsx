"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type Resolver,
  type UseFormSetValue,
} from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { clientEnv } from "@/lib/env.client"
import { refreshAfterFailure } from "@/lib/refresh-after-failure"
import { phtInputToUtc } from "@/lib/time"

import {
  createTaskAction,
  updateTaskAction,
  type CreateTaskState,
  type UpdateTaskState,
} from "../actions"
import { taskErrorMessage, type TaskErrorCode } from "../errors"
import { buildMessengerMessage } from "../messenger"
import type { TaskEdit, TaskEditSlot } from "../queries/task-edit"
import type { SlotMemberOption, TaskFormOptions } from "../queries/task-form"
import {
  PRODUCTION_ROLES,
  taskCreateSchema,
  taskUpdateSchema,
  type TaskCreateInput,
  type TaskUpdateSlotInput,
} from "../schemas"
import { copyForMessengerAction } from "./messenger-toast"

const EMPTY_SLOT = { role: PRODUCTION_ROLES[0], memberId: "" } as const

/**
 * The form's values in either mode. In edit mode `taskId`, and each existing
 * slot's `id` and `loadedMemberId` (the member it loaded with, so a save over
 * a reassignment since is refused as stale), ride along unseen; the owner
 * stays null, since edit mode never shows or sends it.
 */
type TaskFormValues = Omit<TaskCreateInput, "slots"> & {
  taskId?: string
  slots: TaskUpdateSlotInput[]
}

type OwnerDefaults = {
  owningSectionId: string | null
  owningDeskId: string | null
}

function emptyValues(owner?: OwnerDefaults): TaskFormValues {
  return {
    title: "",
    description: null,
    owningSectionId: owner?.owningSectionId ?? null,
    owningDeskId: owner?.owningDeskId ?? null,
    dueAt: "",
    referenceUrl: null,
    slots: [{ ...EMPTY_SLOT }],
  }
}

function editValues(task: TaskEdit): TaskFormValues {
  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    owningSectionId: null,
    owningDeskId: null,
    dueAt: task.dueAtInput,
    referenceUrl: task.referenceUrl,
    slots: task.slots.map((slot) => ({
      id: slot.id,
      loadedMemberId: slot.memberId,
      role: slot.role,
      memberId: slot.memberId,
    })),
  }
}

// Each mode validates with its own action's schema, so the form refuses
// exactly what the action would. Both read these values: create's drops the
// ids, update's the owner (which its schema doesn't know, hence the wider
// cast) and requires the taskId edit mode always holds.
const createResolver = zodResolver(taskCreateSchema) as Resolver<TaskFormValues>
const updateResolver = zodResolver(
  taskUpdateSchema
) as unknown as Resolver<TaskFormValues>

// The refusals after which the page re-reads the task, so the keyed form
// opens again on the latest (UX-DR56), or the page shows why it can't: the
// task changed, went or left the caller's hands, the caller is no longer
// active, a member the form offered has left, or the task was marked Done
// (its slots then show read-only).
const RELOAD_CODES: ReadonlySet<TaskErrorCode> = new Set([
  "tasks.stale",
  "tasks.not_found",
  "tasks.not_approver",
  "auth.not_active",
  "tasks.invalid_slot_member",
  "tasks.not_allowed",
])

// "" -> null so an untouched optional field submits as null, matching
// taskCreateSchema's `.nullable()` fields (not `.optional()`: the value is
// always present, sometimes empty).
function blankToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

// The task is saved by now, so a message that can't be built must not turn
// the save into a failure: the toast just loses its action.
function messengerMessage(
  taskId: string,
  data: TaskFormValues,
  roleLabels: TaskFormOptions["roleLabels"]
): string | null {
  try {
    return buildMessengerMessage(
      {
        id: taskId,
        title: data.title,
        roles: data.slots.map((slot) => slot.role),
        dueAt: phtInputToUtc(data.dueAt),
      },
      clientEnv.NEXT_PUBLIC_SITE_URL,
      roleLabels
    )
  } catch {
    return null
  }
}

/**
 * The admin task form (spec-1-5-admin-task-creation.md): title, description,
 * one owner (a content section or a desk, never Writers — `options.owners`
 * simply never includes it), one or more role slots, a due date entered in
 * PHT, and an optional reference link. On success it toasts "Task created"
 * and resets, keeping the owner so an admin creating several tasks for the
 * same section or desk doesn't re-pick it every time.
 *
 * Given a `task`, it edits that task instead (Story 3.7): prefilled, the
 * owner and each existing slot's role read-only, **Save changes**. A Done
 * task's slots are read-only too (no add, remove or member change), since
 * update_task takes only its text. A save
 * toasts "Task saved." (with Copy for Messenger when a slot got a new
 * member) and goes to Task detail. A stale, missing or refused save toasts
 * its copy and re-reads the page, whose key on the task's version and slots
 * remounts this form on the latest; any other failure keeps what was typed.
 */
export function TaskForm({
  options,
  task,
}: {
  options: TaskFormOptions
  task?: TaskEdit
}) {
  const router = useRouter()
  // Set once an edit is saved, so nothing resends it while the page leaves.
  const [leaving, setLeaving] = useState(false)
  const {
    register,
    handleSubmit,
    control,
    setValue,
    trigger,
    reset,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<TaskFormValues>({
    // A field shows its error once it is left, then re-checks as it is
    // typed in. Only the registered inputs blur into validation: the Selects
    // get no onBlur, since opening one blurs its trigger and would flag it
    // mid-choice, so they wait for submit, then re-check on change. Under
    // this mode useFieldArray also re-checks `slots` after every Add slot and
    // Remove, which would flag untouched slot rows (an empty member reads as
    // "Choose a member"), so the slot errors render only once the form has
    // been submitted.
    mode: "onTouched",
    resolver: task ? updateResolver : createResolver,
    defaultValues: task ? editValues(task) : emptyValues(),
  })

  const { fields, append, remove } = useFieldArray({ control, name: "slots" })

  const owningSectionId = useWatch({ control, name: "owningSectionId" })
  const owningDeskId = useWatch({ control, name: "owningDeskId" })
  const ownerValue = owningSectionId
    ? `section:${owningSectionId}`
    : owningDeskId
      ? `desk:${owningDeskId}`
      : ""

  const existingSlots = new Map<string, TaskEditSlot>(
    (task?.slots ?? []).map((slot) => [slot.id, slot])
  )
  // A Done task is text-only: its slots can't change.
  const slotsLocked = task?.done === true

  function handleOwnerChange(value: string) {
    // Split on the first ":" only: `owner.id` is a slug from a closed,
    // colon-free reference set today, but the value itself is built as
    // `${kind}:${id}`, so a naive split(":") would still silently truncate
    // an id that ever did contain one.
    const sep = value.indexOf(":")
    const kind = value.slice(0, sep)
    const id = value.slice(sep + 1)
    // Set both, then check both. Validating on each setValue would check
    // "exactly one owner" between the two, while both are null, and pin that
    // error on the owner field; setting the desk only re-checks the desk.
    setValue("owningSectionId", kind === "section" ? id : null)
    setValue("owningDeskId", kind === "desk" ? id : null)
    void trigger(["owningSectionId", "owningDeskId"])
  }

  async function onCreate(data: TaskFormValues) {
    let result: CreateTaskState
    try {
      result = await createTaskAction(data)
    } catch {
      toast.error(taskErrorMessage("tasks.create_failed"))
      return
    }
    if (!result.ok) {
      toast.error(taskErrorMessage(result.code))
      return
    }
    const text = messengerMessage(result.data.id, data, options.roleLabels)
    toast.success(
      "Task created",
      text === null ? undefined : copyForMessengerAction(text)
    )
    reset(
      emptyValues({
        owningSectionId: data.owningSectionId,
        owningDeskId: data.owningDeskId,
      })
    )
  }

  async function onUpdate(data: TaskFormValues) {
    let result: UpdateTaskState
    try {
      result = await updateTaskAction(data)
    } catch {
      toast.error(taskErrorMessage("tasks.save_failed"))
      return
    }
    if (!result.ok) {
      toast.error(taskErrorMessage(result.code))
      if (RELOAD_CODES.has(result.code)) refreshAfterFailure(router)
      return
    }
    const { taskId, newAssignee } = result.data
    const text = newAssignee
      ? messengerMessage(taskId, data, options.roleLabels)
      : null
    toast.success(
      "Task saved.",
      text === null ? undefined : copyForMessengerAction(text)
    )
    setLeaving(true)
    router.push(`/dashboard/tasks/${taskId}`)
  }

  const slotsRootError = isSubmitted ? errors.slots?.root : undefined

  return (
    <form
      onSubmit={handleSubmit(task ? onUpdate : onCreate)}
      noValidate
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        <Field data-invalid={!!errors.title || undefined}>
          <FieldLabel htmlFor="task-title">Title</FieldLabel>
          <Input
            id="task-title"
            aria-invalid={!!errors.title}
            {...register("title")}
          />
          <FieldError errors={[errors.title]} />
        </Field>

        <Field data-invalid={!!errors.description || undefined}>
          <FieldLabel htmlFor="task-description">Description</FieldLabel>
          <Textarea
            id="task-description"
            aria-invalid={!!errors.description}
            {...register("description", { setValueAs: blankToNull })}
          />
          <FieldError errors={[errors.description]} />
        </Field>

        {task ? (
          // Fixed at creation: shown, never sent.
          <Field aria-labelledby="task-owner-label">
            <FieldTitle id="task-owner-label">Owner</FieldTitle>
            <p className="flex min-h-8 items-center">{task.ownerName}</p>
          </Field>
        ) : (
          <Field data-invalid={!!errors.owningSectionId || undefined}>
            <FieldLabel htmlFor="task-owner">Owner</FieldLabel>
            <Select value={ownerValue} onValueChange={handleOwnerChange}>
              <SelectTrigger
                id="task-owner"
                aria-invalid={!!errors.owningSectionId}
              >
                <SelectValue placeholder="Choose an owner" />
              </SelectTrigger>
              <SelectContent>
                {options.owners.map((owner) => (
                  <SelectItem
                    key={`${owner.kind}:${owner.id}`}
                    value={`${owner.kind}:${owner.id}`}
                  >
                    {owner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.owningSectionId]} />
          </Field>
        )}

        <Field data-invalid={!!errors.dueAt || undefined}>
          <FieldLabel htmlFor="task-due-at">Due date</FieldLabel>
          <Input
            id="task-due-at"
            type="datetime-local"
            aria-invalid={!!errors.dueAt}
            {...register("dueAt")}
          />
          <FieldError errors={[errors.dueAt]} />
        </Field>

        <Field data-invalid={!!errors.referenceUrl || undefined}>
          <FieldLabel htmlFor="task-reference-url">Reference link</FieldLabel>
          <Input
            id="task-reference-url"
            type="url"
            aria-invalid={!!errors.referenceUrl}
            {...register("referenceUrl", { setValueAs: blankToNull })}
          />
          <FieldError errors={[errors.referenceUrl]} />
        </Field>

        <FieldSet>
          <FieldLegend>Slots</FieldLegend>
          <div className="flex flex-col gap-3">
            {fields.map((field, index) => (
              <SlotRow
                key={field.id}
                index={index}
                options={options}
                existingSlots={existingSlots}
                readOnly={slotsLocked}
                control={control}
                setValue={setValue}
                errors={errors}
                showErrors={isSubmitted}
                onRemove={
                  !slotsLocked && fields.length > 1
                    ? () => remove(index)
                    : undefined
                }
              />
            ))}
          </div>
          {!slotsLocked && (
            <Button
              type="button"
              variant="outline"
              onClick={() => append({ ...EMPTY_SLOT })}
            >
              Add slot
            </Button>
          )}
          <FieldError errors={[slotsRootError]} />
        </FieldSet>
      </FieldGroup>

      <Button type="submit" disabled={isSubmitting || leaving}>
        {task ? "Save changes" : "Create task"}
      </Button>
    </form>
  )
}

function SlotRow({
  index,
  options,
  existingSlots,
  readOnly,
  control,
  setValue,
  errors,
  showErrors,
  onRemove,
}: {
  index: number
  options: TaskFormOptions
  /** Edit mode's slots as loaded, by id; empty when creating. */
  existingSlots: Map<string, TaskEditSlot>
  /** A Done task's slot: its member shows as text, like its role. */
  readOnly: boolean
  control: Control<TaskFormValues>
  setValue: UseFormSetValue<TaskFormValues>
  errors: FieldErrors<TaskFormValues>
  /** False until the form is submitted: see the useForm comment. */
  showErrors: boolean
  onRemove?: () => void
}) {
  const role = useWatch({ control, name: `slots.${index}.role` })
  const slotId = useWatch({ control, name: `slots.${index}.id` })
  const memberId = useWatch({ control, name: `slots.${index}.memberId` })
  // An existing slot keeps its role (changing it is a remove and an add).
  const existing = slotId !== undefined ? existingSlots.get(slotId) : undefined
  const previousRole = useRef(role)
  const roleMembers = options.slotMembersByRole[role] ?? []
  // An existing slot whose member isn't on the role's desk list opens on
  // everyone, so its member shows as chosen.
  const [showEveryone, setShowEveryone] = useState(
    () =>
      existing !== undefined &&
      !roleMembers.some((member) => member.id === existing.memberId)
  )
  // A member the pickers no longer offer (not active any more) is kept as
  // an option, under the name the read gave them ("Former member").
  const formerMember: SlotMemberOption | null =
    existing !== undefined &&
    !options.allMembers.some((member) => member.id === existing.memberId)
      ? { id: existing.memberId, name: existing.memberName }
      : null
  const listed = [
    ...(showEveryone || roleMembers.length === 0
      ? options.allMembers
      : roleMembers),
    ...(formerMember ? [formerMember] : []),
  ]
  // The member the slot holds now stays in its list whatever Show everyone
  // says, so the Select never shows blank while that member still submits.
  const current =
    memberId !== "" && !listed.some((member) => member.id === memberId)
      ? options.allMembers.find((member) => member.id === memberId)
      : undefined
  const memberOptions = current ? [...listed, current] : listed
  const rowErrors = showErrors ? errors.slots?.[index] : undefined

  // A member chosen for the old role isn't necessarily valid for the new
  // one, and the Select would just show it as unselected without this: the
  // stale id stays in form state and would still submit if the admin didn't
  // notice and re-pick.
  useEffect(() => {
    if (previousRole.current !== role) {
      previousRole.current = role
      setValue(`slots.${index}.memberId`, "", { shouldValidate: false })
    }
  }, [role, index, setValue])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start">
      {existing ? (
        <Field
          className="flex-1"
          aria-labelledby={`task-slot-${index}-role-label`}
        >
          <FieldTitle id={`task-slot-${index}-role-label`}>Role</FieldTitle>
          <p className="flex min-h-8 items-center">
            {options.roleLabels[existing.role]}
          </p>
        </Field>
      ) : (
        <Field className="flex-1" data-invalid={!!rowErrors?.role || undefined}>
          <FieldLabel htmlFor={`task-slot-${index}-role`}>Role</FieldLabel>
          <Controller
            control={control}
            name={`slots.${index}.role`}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={`task-slot-${index}-role`}
                  aria-invalid={!!rowErrors?.role}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCTION_ROLES.map((productionRole) => (
                    <SelectItem key={productionRole} value={productionRole}>
                      {options.roleLabels[productionRole]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[rowErrors?.role]} />
        </Field>
      )}

      {readOnly && existing ? (
        <Field
          className="flex-1"
          aria-labelledby={`task-slot-${index}-member-label`}
        >
          <FieldTitle id={`task-slot-${index}-member-label`}>Member</FieldTitle>
          <p className="flex min-h-8 items-center">{existing.memberName}</p>
        </Field>
      ) : (
        <Field
          className="flex-1"
          data-invalid={!!rowErrors?.memberId || undefined}
        >
          <FieldLabel htmlFor={`task-slot-${index}-member`}>Member</FieldLabel>
          <Controller
            control={control}
            name={`slots.${index}.memberId`}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={`task-slot-${index}-member`}
                  aria-invalid={!!rowErrors?.memberId}
                >
                  <SelectValue placeholder="Choose a member" />
                </SelectTrigger>
                <SelectContent>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[rowErrors?.memberId]} />
          {roleMembers.length > 0 &&
            roleMembers.length < options.allMembers.length && (
              <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showEveryone}
                  onChange={(event) => setShowEveryone(event.target.checked)}
                />
                Show everyone
              </label>
            )}
        </Field>
      )}

      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove slot ${index + 1}`}
          className="sm:mt-6"
        >
          Remove
        </Button>
      )}
    </div>
  )
}
