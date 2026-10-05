import {
  buildCalendarEvent,
  buildIcs,
  getTaskForCalendar,
  googleCalendarUrl,
} from "@/features/tasks"
import { clientEnv } from "@/lib/env.client"
import { createClient } from "@/lib/supabase/server"

const NO_STORE = "private, no-store"

// One body for every miss: no session, a bad id, an unreadable task, a
// failed read. Nothing here says which.
function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": NO_STORE,
    },
  })
}

// Read-only (AD-3): the caller's session reads one task, nothing is written.
// /api isn't proxied, so the session is checked here.
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/tasks/[id]/ics">
) {
  const { id } = await ctx.params

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data?.claims?.sub) return notFound()

    const task = await getTaskForCalendar(id)
    if (!task) return notFound()

    const event = buildCalendarEvent(task, clientEnv.NEXT_PUBLIC_SITE_URL)

    if (new URL(request.url).searchParams.get("to") === "google") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: googleCalendarUrl(event),
          "Cache-Control": NO_STORE,
        },
      })
    }

    const ics = buildIcs(event)
    if (ics === null) return notFound()

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="task-${id}.ics"`,
        "Cache-Control": NO_STORE,
      },
    })
  } catch (error) {
    console.error("GET /api/tasks/[id]/ics failed", error)
    return notFound()
  }
}
