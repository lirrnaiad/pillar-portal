"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import { plannerHref } from "../planner"

const SWITCH_ID = "planner-scope"

/**
 * The Planner's toggle, named for the viewer's home scope ("Layout too",
 * "All articles too"): on, the month adds that scope's tasks. Switching it
 * pushes the Planner's URL with or without `scope=home`, keeping the month
 * shown. A push, not a replace, so Back undoes it. The new state shows at
 * once, while the month behind it loads, and the switch stays mounted (and
 * focused) across the navigation. The label makes the whole 44px row a
 * target.
 */
export function PlannerScopeToggle({
  label,
  checked,
  month,
}: {
  label: string
  /** Whether the scope's tasks are shown now (`scope=home`). */
  checked: boolean
  /**
   * The month on screen, kept when switching, so a page left open past the
   * end of a Manila month doesn't jump to the new one. Undefined drops it.
   */
  month?: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(checked)

  function toggle(next: boolean) {
    startTransition(() => {
      setShown(next)
      router.push(plannerHref({ month, includeScope: next }))
    })
  }

  return (
    <div className="flex items-center gap-3">
      <Switch
        id={SWITCH_ID}
        checked={shown}
        onCheckedChange={toggle}
        className="after:-inset-y-3.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <Label htmlFor={SWITCH_ID} className="min-h-11 cursor-pointer">
        {label}
      </Label>
    </div>
  )
}
