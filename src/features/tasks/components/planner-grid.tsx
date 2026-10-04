import { monthWeeks } from "@/lib/time"
import { cn } from "@/lib/utils"

import { tasksByDay } from "../planner"
import type { TaskCardData } from "../queries"
import { PlannerChip } from "./planner-chip"

const WEEKDAYS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const

/**
 * The Planner's month grid (`md` and up): a table labelled by the month
 * heading, weeks starting on Sunday, each task as a chip on its Manila due
 * date, every chip shown (no "+n more"). Days outside the month are blank
 * cells. Today's cell is `aria-current="date"` with a 2px inset navy ring.
 * The layout is fixed, so a long title truncates instead of widening its
 * column. No directive and no members imports.
 */
export function PlannerGrid({
  month,
  today,
  tasks,
  labelledBy,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The month's tasks, ordered by due date then id. */
  tasks: TaskCardData[]
  /** The id of the heading that names the month. */
  labelledBy: string
}) {
  const byDay = tasksByDay(tasks)

  return (
    <table
      aria-labelledby={labelledBy}
      className="w-full table-fixed border-collapse"
    >
      <thead>
        <tr>
          {WEEKDAYS.map(([short, long]) => (
            <th
              key={short}
              scope="col"
              abbr={long}
              className="pb-2 text-left text-xs font-semibold text-muted-foreground"
            >
              {short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(month).map((week) => (
          <tr key={week.find((day) => day !== null)}>
            {week.map((day, index) => {
              if (day === null) {
                return (
                  <td key={`blank-${index}`} className="border bg-muted/50" />
                )
              }
              const isToday = day === today
              const dayTasks = byDay.get(day) ?? []
              return (
                <td
                  key={day}
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    "h-28 border p-1.5 align-top",
                    isToday && "ring-2 ring-navy ring-inset"
                  )}
                >
                  <time
                    dateTime={day}
                    className={cn(
                      "block px-1 text-xs font-semibold text-muted-foreground",
                      isToday && "text-navy"
                    )}
                  >
                    {Number(day.slice(8))}
                  </time>
                  {dayTasks.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {dayTasks.map((task) => (
                        <li key={task.id}>
                          <PlannerChip task={task} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
