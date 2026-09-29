// The dashboard's two views, chosen by the `view` search parameter. No
// @/features imports: the header's tabs (a client component) use this too.

export type DashboardView = "whats-mine" | "board"

/** `board` selects the Board; anything else, including a repeated parameter, is What's mine. */
export function parseDashboardView(value: unknown): DashboardView {
  return value === "board" ? "board" : "whats-mine"
}

export const DASHBOARD_VIEW_TITLES: Record<DashboardView, string> = {
  "whats-mine": "What's mine · The Pillar Portal",
  board: "Board · The Pillar Portal",
}
