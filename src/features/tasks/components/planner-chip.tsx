import Link from "next/link"
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import {
  plannerChipLabel,
  plannerChipStatus,
  type PlannerChipStatusKind,
} from "../planner"
import type { TaskCardData } from "../queries"

// Each status's glyph and color, at least 3:1 on the card. To Do takes
// muted-foreground: the neutral dot's gray is only 2.5:1 on white.
const GLYPHS: Record<
  PlannerChipStatusKind,
  { icon: LucideIcon; className: string }
> = {
  to_do: { icon: Circle, className: "text-muted-foreground" },
  doing: { icon: CircleDot, className: "text-status-progress" },
  for_review: { icon: CircleDot, className: "text-status-progress" },
  done: { icon: CircleCheck, className: "text-status-positive" },
  overdue: { icon: CircleAlert, className: "text-status-attention" },
}

/**
 * One task in the Planner's month grid (DESIGN.md › Planner chip): a card
 * pill with the card shadow, a status glyph, then the title on one line. A
 * link to Task detail, since opening a task is navigation (so it also opens
 * in a new tab); its name carries the title, the status and the PHT due
 * time. 28px tall, which meets WCAG 2.5.8 in a grid that phones never see.
 * No directive and no members imports.
 */
export function PlannerChip({ task }: { task: TaskCardData }) {
  const { icon: Glyph, className } = GLYPHS[plannerChipStatus(task).kind]

  return (
    <Link
      href={`/dashboard/tasks/${task.id}`}
      aria-label={plannerChipLabel(task)}
      className="flex min-h-7 min-w-0 items-center gap-1.5 rounded-full bg-card px-2 text-xs font-medium shadow-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      <Glyph aria-hidden="true" className={cn("size-3 shrink-0", className)} />
      <span className="truncate">{task.title}</span>
    </Link>
  )
}
