// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { AddToCalendarMenu, TaskCardMenu } from "./calendar-menu"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ID = "00000000-0000-4000-8000-000000000021"

describe("AddToCalendarMenu", () => {
  it("offers both options and toasts on download", async () => {
    const user = userEvent.setup()
    render(<AddToCalendarMenu taskId={ID} googleUrl="https://g.test/x" />)
    await user.click(
      screen.getByRole("button", { name: "Add to Google Calendar" })
    )
    const google = screen.getByRole("menuitem", {
      name: /Open in Google Calendar/,
    })
    expect(google).toHaveAttribute("href", "https://g.test/x")
    expect(google).toHaveAttribute("target", "_blank")
    expect(google).toHaveAttribute("rel", "noopener noreferrer")

    const download = screen.getByRole("menuitem", { name: "Download .ics" })
    expect(download).toHaveAttribute("href", `/api/tasks/${ID}/ics`)
    const violations = (
      await axe.run(screen.getByRole("menu"), {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations
    expect(violations).toEqual([])
    download.addEventListener("click", (e) => e.preventDefault())
    await user.click(download)
    expect(toast).toHaveBeenCalledWith("Calendar file downloaded.")
  })
})

describe("TaskCardMenu", () => {
  it("is named for the task, links through the route and returns focus on Escape", async () => {
    const user = userEvent.setup()
    render(<TaskCardMenu taskId={ID} title="Lay out" />)
    const trigger = screen.getByRole("button", {
      name: "More actions, Lay out",
    })
    await user.click(trigger)
    expect(
      screen.getByRole("menuitem", { name: /Open in Google Calendar/ })
    ).toHaveAttribute("href", `/api/tasks/${ID}/ics?to=google`)
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("stops mousedown and touchstart from reaching the card", async () => {
    const parent = vi.fn()
    render(
      <div onMouseDown={parent} onTouchStart={parent}>
        <TaskCardMenu taskId={ID} title="Lay out" />
      </div>
    )
    const trigger = screen.getByRole("button", { name: /More actions/ })
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.mouseDown(trigger)
    fireEvent.touchStart(trigger)
    expect(parent).not.toHaveBeenCalled()
  })
})
