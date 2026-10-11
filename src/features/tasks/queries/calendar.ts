import "server-only"

import { createClient } from "@/lib/supabase/server"

import type { CalendarTask } from "../calendar"
import { taskIdSchema } from "./shared"

/**
 * The few columns the calendar event needs, read as the caller. Null for a
 * malformed id, a task the caller can't read and any query error, so the
 * route answers all three the same way.
 */
export async function getTaskForCalendar(
  id: string
): Promise<CalendarTask | null> {
  if (!taskIdSchema.safeParse(id).success) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, due_at, reference_url")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    dueAt: data.due_at,
    referenceUrl: data.reference_url,
  }
}
