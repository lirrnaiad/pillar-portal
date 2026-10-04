import {
  getPlanner,
  PlannerDayList,
  PlannerGrid,
  type PlannerScope,
} from "@/features/tasks"

// One month of the Planner: the month grid from md, the day list below it,
// or only "No deadlines this month." when the month has no tasks. Loads under
// its own Suspense boundary, so changing the month or the toggle keeps the
// controls mounted while this reloads.
export async function PlannerMonth({
  month,
  scope,
  today,
  headingId,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** The home scope whose tasks the toggle adds, or null while it is off. */
  scope: PlannerScope | null
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The id of the heading that names the month (the grid's label). */
  headingId: string
}) {
  const tasks = await getPlanner(month, scope)

  if (tasks.length === 0) {
    return <p className="text-muted-foreground">No deadlines this month.</p>
  }

  return (
    <>
      <div className="hidden md:block">
        <PlannerGrid
          month={month}
          today={today}
          tasks={tasks}
          labelledBy={headingId}
        />
      </div>
      <div className="md:hidden">
        <PlannerDayList month={month} today={today} tasks={tasks} />
      </div>
    </>
  )
}
