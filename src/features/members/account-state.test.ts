import { describe, expect, it } from "vitest"

import { ACCOUNT_STATE_COPY, memberStateOf } from "./account-state"

const AT = "2026-10-12T09:00:00+00:00"

describe("memberStateOf", () => {
  it.each([
    ["staff", null, null, "active"],
    ["editorial_admin", null, null, "active"],
    ["pending", null, null, "pending"],
    ["pending", AT, null, "declined"],
    ["staff", null, AT, "deactivated"],
    ["editorial_admin", null, AT, "deactivated"],
    // Precedence: deactivated over declined over pending.
    ["pending", AT, AT, "deactivated"],
    ["pending", null, AT, "deactivated"],
    // A row the database's CHECK refuses still reads as not active.
    ["staff", AT, null, "declined"],
  ] as const)(
    "role %s, declined_at %s, deactivated_at %s is %s",
    (role, declinedAt, deactivatedAt, state) => {
      expect(memberStateOf({ role, declinedAt, deactivatedAt })).toBe(state)
    }
  )
})

describe("ACCOUNT_STATE_COPY", () => {
  it("uses EXPERIENCE.md's titles and texts", () => {
    expect(ACCOUNT_STATE_COPY).toEqual({
      pending: {
        title: "Awaiting approval",
        text: "You're signed in — a Board member will approve you shortly. Tell your editor or head you've joined.",
      },
      declined: {
        title: "Access declined",
        text: "Your access request wasn't approved. If this is a mistake, ask your editor or head.",
      },
      deactivated: {
        title: "No access",
        text: "Your access to the portal has ended. If this is a mistake, ask your editor or head.",
      },
    })
  })
})
