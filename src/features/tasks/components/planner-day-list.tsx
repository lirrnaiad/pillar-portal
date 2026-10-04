import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { phtDayLabel } from "@/lib/time"

import { deadlineCount, tasksByDay } from "../planner"
import type { TaskCardData } from "../queries"
import { TaskCard } from "./task-card"

/**
 * The Planner below `md`: an accordion of the month's days with deadlines,
 * plus today when today is in the month, in date order. Only today starts
 * expanded (another month starts with none). Each 44px trigger reads the day,
 * " · Today" on today, and its count; each panel lists the day's tasks as
 * task cards, titled h4 under the day's h3 (Radix's accordion header). No
 * directive: the Accordion is the client part.
 */
export function PlannerDayList({
  month,
  today,
  tasks,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The month's tasks, ordered by due date then id. */
  tasks: TaskCardData[]
}) {
  const byDay = tasksByDay(tasks)
  const todayInMonth = today.startsWith(`${month}-`)
  const days = [...byDay.keys()]
  if (todayInMonth && !byDay.has(today)) days.push(today)
  // `YYYY-MM-DD` keys sort as dates.
  days.sort()

  return (
    <Accordion type="multiple" defaultValue={todayInMonth ? [today] : []}>
      {days.map((day) => {
        const dayTasks = byDay.get(day) ?? []
        const label = `${phtDayLabel(day)}${day === today ? " · Today" : ""}`
        const count = deadlineCount(dayTasks.length)
        return (
          <AccordionItem key={day} value={day}>
            {/* Named explicitly: the day and its count are two spans, which
                accessible-name rules may run together without a pause. */}
            <AccordionTrigger
              aria-label={`${label}, ${count}`}
              className="min-h-11 items-center gap-2 py-2 text-base font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>{label}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {count}
                </span>
              </span>
            </AccordionTrigger>
            {/* Undoes the panel defaults a task card can't take: the fixed
                height (which would clip a card that rewraps after opening),
                underlined links and spaced paragraphs. */}
            <AccordionContent className="h-auto px-1 pt-1 pb-3 text-base [&_a]:no-underline [&_p:not(:last-child)]:mb-0">
              {dayTasks.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {dayTasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard task={task} headingLevel={4} />
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
