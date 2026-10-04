// The Planner's URL and copy. Client-safe: no `server-only`, and no values
// from @/features/members (the toggle's scope is the Board's OwnerFilter).

import { formatInPht, phtDayKey } from "@/lib/time"

import type { OwnerFilter, TaskOwnerOption } from "./board"
import { TASK_COLUMN_LABELS, type TaskColumn } from "./status"

/** A home scope the Planner's toggle can add: anything but All. */
export type PlannerScope = Exclude<OwnerFilter, { kind: "all" }>

/** The toggle's name: "<desk or section> too", or "All articles too". */
export function plannerScopeLabel(
  scope: PlannerScope,
  owners: TaskOwnerOption[]
): string {
  if (scope.kind === "articles") return "All articles too"
  const name =
    owners.find((owner) => owner.kind === scope.kind && owner.id === scope.id)
      ?.name ?? scope.id
  return `${name} too`
}

/**
 * Whether the `scope` parameter asks for the home scope's tasks: only
 * `home`, never a repeated parameter. The page still turns it off when the
 * viewer has no toggle.
 */
export function parseIncludeScope(value: unknown): boolean {
  return value === "home"
}

/**
 * The Planner's URL: `month` when one is given (Today leaves it out, so the
 * page resolves the current Manila month), and `scope=home` while the toggle
 * is on.
 */
export function plannerHref({
  month,
  includeScope,
}: {
  month?: string
  includeScope: boolean
}): string {
  const params = new URLSearchParams({ view: "planner" })
  if (month) params.set("month", month)
  if (includeScope) params.set("scope", "home")
  return `/dashboard?${params}`
}

/**
 * Tasks grouped by their Manila due date (`YYYY-MM-DD`), each day's tasks in
 * the order given.
 */
export function tasksByDay<T extends { dueAt: string }>(
  tasks: T[]
): Map<string, T[]> {
  const byDay = new Map<string, T[]>()
  for (const task of tasks) {
    const day = phtDayKey(task.dueAt)
    const list = byDay.get(day) ?? []
    list.push(task)
    byDay.set(day, list)
  }
  return byDay
}

/** "No deadlines", "1 deadline", "<n> deadlines": a day row's count. */
export function deadlineCount(count: number): string {
  if (count === 0) return "No deadlines"
  return count === 1 ? "1 deadline" : `${count} deadlines`
}

export type PlannerChipStatusKind = TaskColumn | "overdue"

type ChipTask = {
  title: string
  dueAt: string
  column: TaskColumn
  overdue: boolean
}

/** A chip's status: Overdue when the task is, otherwise its column. */
export function plannerChipStatus(task: Pick<ChipTask, "column" | "overdue">): {
  kind: PlannerChipStatusKind
  label: string
} {
  if (task.overdue) return { kind: "overdue", label: "Overdue" }
  return { kind: task.column, label: TASK_COLUMN_LABELS[task.column] }
}

const CHIP_DUE_FORMAT = "EEE, MMM d 'at' h:mm a"

/** "<title>, <status>, due Sat, Oct 10 at 5:00 PM" (PHT): the chip's name. */
export function plannerChipLabel(task: ChipTask): string {
  const { label } = plannerChipStatus(task)
  return `${task.title}, ${label}, due ${formatInPht(task.dueAt, CHIP_DUE_FORMAT)}`
}
