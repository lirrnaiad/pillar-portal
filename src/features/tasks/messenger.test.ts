import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildMessengerMessage, copyText } from "./messenger"

const LABELS = {
  writer: "Writer",
  layout_artist: "Layout Artist",
  cartoonist: "Cartoonist",
  photojournalist: "Photojournalist",
  broadcast_journalist: "Broadcast Journalist",
  videojournalist: "Videojournalist",
}
const ID = "00000000-0000-4000-8000-000000000021"
// 17:00 PHT on Friday, October 16, 2026.
const DUE = "2026-10-16T09:00:00+00:00"

describe("buildMessengerMessage", () => {
  it("builds the title, roles, PHT date and link", () => {
    expect(
      buildMessengerMessage(
        { id: ID, title: "Lay out", roles: ["layout_artist"], dueAt: DUE },
        "https://pillar.example",
        LABELS
      )
    ).toBe(
      `📌 Lay out — Layout Artist · due Fri, Oct 16, 5:00 PM\nhttps://pillar.example/dashboard/tasks/${ID}`
    )
  })

  it("de-duplicates roles and keeps slot order", () => {
    const message = buildMessengerMessage(
      {
        id: ID,
        title: "T",
        roles: ["photojournalist", "layout_artist", "photojournalist"],
        dueAt: new Date(DUE),
      },
      "https://pillar.example",
      LABELS
    )
    expect(message).toContain("— Photojournalist / Layout Artist ·")
  })

  it.each(["Asia/Manila", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"])(
    "formats the date the same under %s",
    (zone) => {
      vi.stubEnv("TZ", zone)
      expect(
        buildMessengerMessage(
          { id: ID, title: "T", roles: ["writer"], dueAt: DUE },
          "https://pillar.example",
          LABELS
        )
      ).toContain("due Fri, Oct 16, 5:00 PM")
    }
  )

  it("takes the link from the site URL it is given, nothing else", () => {
    const message = buildMessengerMessage(
      { id: ID, title: "T", roles: ["writer"], dueAt: DUE },
      "https://pillar.example",
      LABELS
    )
    expect(message.split("\n")[1]).toBe(
      `https://pillar.example/dashboard/tasks/${ID}`
    )
  })
})

describe("copyText", () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it("is true after writing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    expect(await copyText("hi")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hi")
  })

  it("is false with no clipboard or a refusal", async () => {
    vi.stubGlobal("navigator", {})
    expect(await copyText("hi")).toBe(false)
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    })
    expect(await copyText("hi")).toBe(false)
  })
})
