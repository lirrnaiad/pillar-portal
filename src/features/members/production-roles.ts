import type { Enums } from "@/lib/supabase/database.types"

export type ProductionRole = Enums<"production_role">

/**
 * Display labels for `production_role`, the one map every slice uses (desks,
 * task slots, applicant positions). members-data.test.ts keeps its keys equal
 * to the database enum.
 */
export const PRODUCTION_ROLE_LABELS: Record<ProductionRole, string> = {
  writer: "Writer",
  layout_artist: "Layout Artist",
  cartoonist: "Cartoonist",
  photojournalist: "Photojournalist",
  broadcast_journalist: "Broadcast Journalist",
  videojournalist: "Videojournalist",
}
