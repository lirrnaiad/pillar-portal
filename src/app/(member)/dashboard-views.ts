// The dashboard's three views, chosen by the `view` search parameter. No
// @/features imports: the header's tabs (a client component) use this too.

export type DashboardView = "whats-mine" | "board" | "planner"

/**
 * `board` selects the Board and `planner` the Planner; anything else,
 * including a repeated parameter, is What's mine.
 */
export function parseDashboardView(value: unknown): DashboardView {
  return value === "board" || value === "planner" ? value : "whats-mine"
}

export const DASHBOARD_VIEW_TITLES: Record<DashboardView, string> = {
  "whats-mine": "What's mine · The Pillar Portal",
  board: "Board · The Pillar Portal",
  planner: "Planner · The Pillar Portal",
}
