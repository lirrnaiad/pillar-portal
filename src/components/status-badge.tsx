import { cn } from "@/lib/utils"

/**
 * A DESIGN.md status family (globals.css's `status-*` tokens). `none` is a
 * state with no accent of its own ("On it" is the normal case), so it shows
 * the label untinted.
 */
export type StatusFamily =
  "neutral" | "progress" | "positive" | "attention" | "none"

const DOT_COLOR: Record<Exclude<StatusFamily, "none">, string> = {
  neutral: "bg-status-neutral",
  progress: "bg-status-progress",
  positive: "bg-status-positive",
  attention: "bg-status-attention",
}

const BADGE_COLOR: Record<StatusFamily, string> = {
  neutral: "bg-status-neutral-tint text-status-neutral-text",
  progress: "bg-status-progress-tint text-status-progress-text",
  positive: "bg-status-positive-tint text-status-positive-text",
  attention: "bg-status-attention-tint text-status-attention-text",
  none: "text-foreground",
}

/**
 * An 8px dot in the family's color beside its text label (DESIGN.md › Status
 * dot): color never carries the status alone. `none` shows the label only.
 */
export function StatusDot({
  family,
  label,
  className,
}: {
  family: StatusFamily
  label: string
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {family !== "none" && (
        <span
          aria-hidden="true"
          data-family={family}
          className={cn("size-2 shrink-0 rounded-full", DOT_COLOR[family])}
        />
      )}
      <span>{label}</span>
    </span>
  )
}

/**
 * A pill with the family's tint and dark text, 11.5px semibold, never
 * outlined (DESIGN.md › Status badge). It is announced as "Status: <label>"
 * (EXPERIENCE.md › Accessibility Floor); `role="img"` is what lets that
 * label replace the visible text, since ARIA doesn't allow naming a plain
 * span.
 */
export function StatusBadge({
  family,
  label,
  className,
}: {
  family: StatusFamily
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      data-family={family}
      className={cn(
        "inline-flex items-center rounded-full px-[9px] py-[3px] text-status-badge whitespace-nowrap",
        BADGE_COLOR[family],
        className
      )}
    >
      {label}
    </span>
  )
}
