"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ownerFilterParam, type TaskOwnerOption } from "../board"

/**
 * The Board's one owner filter, as a labelled select: All, All articles, then
 * the sections and the desks. Choosing one pushes `?view=board&owner=<value>`
 * (each value from `ownerFilterParam`, the one writer of that format); the
 * page reads it back. A push, not a replace, so Back returns to the last
 * filter. The choice shows
 * at once, while the columns behind it load, and the control stays mounted
 * (and focused) across the navigation.
 */
export function BoardOwnerFilter({
  owners,
  value,
}: {
  owners: TaskOwnerOption[]
  /** The current filter's `owner` parameter value. */
  value: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(value)

  function choose(next: string) {
    startTransition(() => {
      setShown(next)
      router.push(
        "/dashboard?" + new URLSearchParams({ view: "board", owner: next })
      )
    })
  }

  const sections = owners.filter((owner) => owner.kind === "section")
  const desks = owners.filter((owner) => owner.kind === "desk")

  return (
    <div className="flex flex-col gap-2 sm:max-w-xs">
      <Label htmlFor="board-owner">Section or desk</Label>
      <Select value={shown} onValueChange={choose}>
        <SelectTrigger id="board-owner" className="min-h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            value={ownerFilterParam({ kind: "all" })}
            className="min-h-11"
          >
            All
          </SelectItem>
          <SelectItem
            value={ownerFilterParam({ kind: "articles" })}
            className="min-h-11"
          >
            All articles
          </SelectItem>
          <SelectGroup>
            <SelectLabel>Sections</SelectLabel>
            {sections.map((owner) => (
              <SelectItem
                key={owner.id}
                value={ownerFilterParam({ kind: "section", id: owner.id })}
                className="min-h-11"
              >
                {owner.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Desks</SelectLabel>
            {desks.map((owner) => (
              <SelectItem
                key={owner.id}
                value={ownerFilterParam({ kind: "desk", id: owner.id })}
                className="min-h-11"
              >
                {owner.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
