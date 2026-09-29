"use client"

import { useEffect } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

export const TASK_CHANGES_TOPIC = "task-changes"

const REFRESH_DELAY_MS = 300
// A steady stream of events can't hold a refresh off for longer than this.
const REFRESH_MAX_WAIT_MS = 2000

/**
 * Keeps an open Board current (AD-14): joins the private `task-changes`
 * channel and, on any change to `tasks` or `task_assignments`, re-reads the
 * page with a debounced `router.refresh()`. The event is only a signal; its
 * payload is never read, so what the Board shows still comes from the
 * server's RLS-gated queries.
 *
 * The channel is private (a `realtime.messages` policy lets active members
 * join and nobody send), which is what makes Realtime reject an anonymous
 * join. `setAuth()` runs first because the join payload carries the access
 * token as it stood at `subscribe()`; without it the first join goes out as
 * anon. Coming back after a drop (a second SUBSCRIBED) refreshes once, since
 * events in the gap were missed.
 *
 * A hidden tab doesn't refresh; it refreshes once when it is shown again if
 * anything changed meanwhile. realtime-js hands back an existing channel with
 * the same topic, even one still leaving after an earlier Board unmounted, and
 * joining that one would do nothing, so a leftover is removed first.
 */
export function TaskChangesRefresher() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let firstEventAt: number | undefined
    let channel: RealtimeChannel | undefined
    let joinedBefore = false
    let changedWhileHidden = false

    function refreshNow() {
      timer = undefined
      firstEventAt = undefined
      if (document.hidden) {
        changedWhileHidden = true
        return
      }
      router.refresh()
    }

    function refresh() {
      const now = Date.now()
      firstEventAt ??= now
      clearTimeout(timer)
      const untilMaxWait = firstEventAt + REFRESH_MAX_WAIT_MS - now
      timer = setTimeout(
        refreshNow,
        Math.max(0, Math.min(REFRESH_DELAY_MS, untilMaxWait))
      )
    }

    function onVisibilityChange() {
      if (document.hidden || !changedWhileHidden) return
      changedWhileHidden = false
      router.refresh()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    async function join() {
      try {
        await supabase.realtime.setAuth()
      } catch {
        // No live updates without a token; the Board still works.
        return
      }
      if (cancelled) return

      const leftover = supabase
        .getChannels()
        .find((existing) => existing.topic === `realtime:${TASK_CHANGES_TOPIC}`)
      if (leftover) {
        await supabase.removeChannel(leftover)
        if (cancelled) return
      }

      channel = supabase
        .channel(TASK_CHANGES_TOPIC, { config: { private: true } })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          () => refresh()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "task_assignments" },
          () => refresh()
        )
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return
          if (joinedBefore) refresh()
          joinedBefore = true
        })
    }
    void join()

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
