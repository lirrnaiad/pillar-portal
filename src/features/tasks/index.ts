// The tasks slice's public surface (AD-2): code outside the slice imports
// from here only.
export {
  createTaskAction,
  moveTaskAction,
  respondToSlotAction,
} from "./actions"
export type {
  CreateTaskState,
  MoveTaskState,
  RespondToSlotState,
} from "./actions"
export { TaskDetailView } from "./components/task-detail-view"
export { TaskForm } from "./components/task-form"
export { TASK_ERROR_COPY, taskErrorMessage } from "./errors"
export type { TaskErrorCode } from "./errors"
export { getTaskDetail, getTaskFormOptions } from "./queries"
export type {
  SlotMemberOption,
  SlotMembersByRole,
  TaskDetail,
  TaskDetailSlot,
  TaskFormOptions,
  TaskOwnerOption,
} from "./queries"
export {
  PRODUCTION_ROLES,
  slotRespondSchema,
  taskCreateSchema,
  taskMoveSchema,
} from "./schemas"
export type {
  SlotRespondInput,
  TaskCreateInput,
  TaskMoveInput,
  TaskSlotInput,
} from "./schemas"
export {
  SLOT_STATE_FAMILIES,
  SLOT_STATE_LABELS,
  TASK_COLUMN_FAMILIES,
  TASK_COLUMN_LABELS,
  TASK_COLUMNS,
} from "./status"
export type { SlotState, TaskColumn } from "./status"
