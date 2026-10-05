"use client"

import { CalendarPlus, EllipsisVertical } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { calendarRoutePath } from "../calendar"

const ITEM = "min-h-11 w-full"
const DOWNLOADED = "Calendar file downloaded."

/**
 * Task detail's menu. `googleUrl` is built on the server from the task, so
 * Google opens straight from a link (a link, not window.open: iPhone in-app
 * browsers block popups).
 */
export function AddToCalendarMenu({
  taskId,
  googleUrl,
}: {
  taskId: string
  googleUrl: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <CalendarPlus aria-hidden className="size-4" />
        Add to Google Calendar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem asChild>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={ITEM}
          >
            Open in Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={calendarRoutePath(taskId)}
            className={ITEM}
            onClick={() => toast(DOWNLOADED)}
          >
            Download .ics
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A card's overflow menu. It sits above the title link's stretched area
 * (`z-10`), so opening it never opens the card. The wrapper stops
 * `mousedown`/`touchstart`, which also covers the menu's portal (React
 * events bubble through it), so on the Board it never starts a drag.
 */
export function TaskCardMenu({
  taskId,
  title,
}: {
  taskId: string
  title: string
}) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <div
      className="absolute top-0 right-0 z-10"
      onMouseDown={stop}
      onTouchStart={stop}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions, ${title}`}
          className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <EllipsisVertical aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem asChild>
            <a
              href={calendarRoutePath(taskId, "google")}
              target="_blank"
              rel="noopener noreferrer"
              className={ITEM}
            >
              Open in Google Calendar
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href={calendarRoutePath(taskId)}
              className={ITEM}
              onClick={() => toast(DOWNLOADED)}
            >
              Download .ics
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
