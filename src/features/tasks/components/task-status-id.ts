// Task detail's status element (TaskColumnControl's), where the review
// controls put focus once their command is saved. It lives in this
// directive-less module, not task-column-control.tsx: imported from a
// "use client" module, a server component such as TaskDetailView would get a
// client reference, not the string.
export const TASK_STATUS_ID = "task-status"
