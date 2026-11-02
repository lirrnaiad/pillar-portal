import "server-only"

import { after } from "next/server"

import {
  type ErrorEventWhere,
  recordErrorEvent,
} from "@/lib/record-error-event"

/**
 * Maps a command's error (AD-3) to a code its UI has copy for. Each action
 * passes its own `known` codes, those its command raises as
 * `raise exception ... message = '<code>'` and the UI expects, and its own
 * generic `fallback`.
 *
 * A known code is expected, so it is returned as is and never recorded.
 * Anything else (a backstop the UI never reaches, a raw database error, a
 * network failure) is unexpected: it is recorded (code, action, entity and id
 * only) after the response, so the toast never waits on it, and `fallback`
 * is returned instead of leaking a raw error to the UI. A parse failure never
 * gets here and is never recorded: it is the caller's input, which anyone can
 * send, and recording it would let anyone fill the table.
 */
export function mapCommandError<C extends string>(
  error: { message: string },
  known: ReadonlySet<C>,
  fallback: C,
  where: ErrorEventWhere
): C {
  const code = error.message as C
  if (known.has(code)) return code
  after(() => recordErrorEvent(error, where))
  return fallback
}
