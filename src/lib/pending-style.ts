// Shown while a command is saving. The controls stay focusable
// (`aria-disabled`, not `disabled`, which would drop focus to the page) and
// ignore input instead.
export const PENDING_STYLE =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
