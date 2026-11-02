-- tasks_finite_due: a task's due date is a real instant (Story 3.9, AD-1,
-- AD-12).
--
-- - `tasks_due_at_finite` refuses `infinity` and `-infinity`, which a
--   `timestamptz` otherwise accepts. Every page that formats `due_at` (Task
--   detail, the Board, What's mine, the Planner, the queues) throws on a
--   non-finite one (`RangeError: Invalid time value`), so one such task would
--   break those pages for every viewer.
-- - Only a direct RPC caller can send one: the task form's `datetime-local`
--   pattern keeps it out. `create_task` and `update_task` are unchanged, so
--   the constraint refuses through both with 23514, which their actions treat
--   as an unexpected fault (the fallback copy, recorded).
-- - Adding the constraint validates every existing row. Staging had no
--   non-finite `due_at` on 2026-11-02.

alter table public.tasks
  add constraint tasks_due_at_finite check (isfinite(due_at));
