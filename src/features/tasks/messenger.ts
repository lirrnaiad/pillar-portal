import { formatInPht } from "@/lib/time"

import type { PRODUCTION_ROLES } from "./schemas"

type ProductionRole = (typeof PRODUCTION_ROLES)[number]

const DUE_FORMAT = "EEE, MMM d, h:mm a"

export const MESSENGER_COPIED = "Copied — paste it in Messenger."
export const MESSENGER_HINT = "Copy this and paste it in Messenger."

export type MessengerTask = {
  id: string
  title: string
  /** One per slot, in slot order; repeats are collapsed. */
  roles: ProductionRole[]
  /** UTC instant; shown in PHT. */
  dueAt: Date | string
}

/**
 * The message pasted into Messenger. `siteUrl` is `NEXT_PUBLIC_SITE_URL`,
 * passed in so this module stays client-safe and never reads a request's Host.
 */
export function buildMessengerMessage(
  task: MessengerTask,
  siteUrl: string,
  roleLabels: Record<ProductionRole, string>
): string {
  const roles = [...new Set(task.roles)].map((role) => roleLabels[role])
  const link = new URL(`/dashboard/tasks/${task.id}`, siteUrl).href
  return `📌 ${task.title} — ${roles.join(" / ")} · due ${formatInPht(task.dueAt, DUE_FORMAT)}\n${link}`
}

/** Writes to the clipboard; false when there is no access or it is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
