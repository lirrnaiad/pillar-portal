"use client"

import { useEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
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

import { createTaskAction, type CreateTaskState } from "../actions"
import { taskErrorMessage } from "../errors"
import type { TaskFormOptions } from "../queries"
import {
  PRODUCTION_ROLES,
  taskCreateSchema,
  type TaskCreateInput,
} from "../schemas"

const EMPTY_SLOT = { role: PRODUCTION_ROLES[0], memberId: "" } as const

type OwnerDefaults = {
  owningSectionId: string | null
  owningDeskId: string | null
}

function emptyValues(owner?: OwnerDefaults): TaskCreateInput {
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

// "" -> null so an untouched optional field submits as null, matching
// taskCreateSchema's `.nullable()` fields (not `.optional()`: the value is
// always present, sometimes empty).
function blankToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/**
 * The admin task-creation form (spec-1-5-admin-task-creation.md): title,
 * description, one owner (a content section or a desk, never Writers —
 * `options.owners` simply never includes it), one or more role slots, a due
 * date entered in PHT, and an optional reference link. On success it toasts
 * "Task created" and resets, keeping the owner so an admin creating several
 * tasks for the same section or desk doesn't re-pick it every time.
 */
export function TaskForm({ options }: { options: TaskFormOptions }) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    trigger,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskCreateInput>({
    resolver: zodResolver(taskCreateSchema),
    defaultValues: emptyValues(),
  })

  const { fields, append, remove } = useFieldArray({ control, name: "slots" })

  const owningSectionId = useWatch({ control, name: "owningSectionId" })
  const owningDeskId = useWatch({ control, name: "owningDeskId" })
  const ownerValue = owningSectionId
    ? `section:${owningSectionId}`
    : owningDeskId
      ? `desk:${owningDeskId}`
      : ""

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

  async function onSubmit(data: TaskCreateInput) {
    let result: CreateTaskState
    try {
      result = await createTaskAction(data)
    } catch {
      toast.error("Couldn't create the task. Try again.")
      return
    }
    if (!result.ok) {
      toast.error(taskErrorMessage(result.code))
      return
    }
    toast.success("Task created")
    reset(
      emptyValues({
        owningSectionId: data.owningSectionId,
        owningDeskId: data.owningDeskId,
      })
    )
  }

  const slotsRootError = errors.slots?.root

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
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
                control={control}
                setValue={setValue}
                errors={errors}
                onRemove={fields.length > 1 ? () => remove(index) : undefined}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => append({ ...EMPTY_SLOT })}
          >
            Add slot
          </Button>
          <FieldError errors={[slotsRootError]} />
        </FieldSet>
      </FieldGroup>

      <Button type="submit" disabled={isSubmitting}>
        Create task
      </Button>
    </form>
  )
}

function SlotRow({
  index,
  options,
  control,
  setValue,
  errors,
  onRemove,
}: {
  index: number
  options: TaskFormOptions
  control: Control<TaskCreateInput>
  setValue: UseFormSetValue<TaskCreateInput>
  errors: FieldErrors<TaskCreateInput>
  onRemove?: () => void
}) {
  const [showEveryone, setShowEveryone] = useState(false)
  const role = useWatch({ control, name: `slots.${index}.role` })
  const previousRole = useRef(role)
  const roleMembers = options.slotMembersByRole[role] ?? []
  const memberOptions =
    showEveryone || roleMembers.length === 0 ? options.allMembers : roleMembers
  const rowErrors = errors.slots?.[index]

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
