// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TaskOwnerOption } from "../board"
import { BoardOwnerFilter } from "./board-owner-filter"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const OWNERS: TaskOwnerOption[] = [
  { kind: "section", id: "news", name: "News" },
  { kind: "section", id: "sports", name: "Sports" },
  { kind: "desk", id: "layout", name: "Layout" },
  { kind: "desk", id: "photo", name: "Photo" },
]

const trigger = () => screen.getByRole("combobox", { name: "Section or desk" })

describe("BoardOwnerFilter", () => {
  it("is a labelled select showing the current filter", () => {
    render(<BoardOwnerFilter owners={OWNERS} value="desk:layout" />)

    expect(trigger()).toHaveTextContent("Layout")
  })

  it("lists All, All articles, then Sections and Desks groups", async () => {
    const user = userEvent.setup()
    render(<BoardOwnerFilter owners={OWNERS} value="all" />)

    await user.click(trigger())

    const listbox = await screen.findByRole("listbox")
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["All", "All articles", "News", "Sports", "Layout", "Photo"])
    // Each group is named by its label.
    const groups = within(listbox).getAllByRole("group")
    expect(
      groups.map((group) => {
        const label = document.getElementById(
          group.getAttribute("aria-labelledby") ?? ""
        )
        return [
          label?.textContent,
          within(group)
            .getAllByRole("option")
            .map((option) => option.textContent),
        ]
      })
    ).toEqual([
      ["Sections", ["News", "Sports"]],
      ["Desks", ["Layout", "Photo"]],
    ])
  })

  it("pushes the board URL with the chosen owner", async () => {
    const user = userEvent.setup()
    render(<BoardOwnerFilter owners={OWNERS} value="all" />)

    await user.click(trigger())
    await user.click(await screen.findByRole("option", { name: "Sports" }))

    expect(push).toHaveBeenCalledWith(
      "/dashboard?view=board&owner=section%3Asports"
    )
  })

  it("pushes desk and article filters in the same form", async () => {
    const user = userEvent.setup()
    render(<BoardOwnerFilter owners={OWNERS} value="all" />)

    await user.click(trigger())
    await user.click(await screen.findByRole("option", { name: "Photo" }))
    expect(push).toHaveBeenLastCalledWith(
      "/dashboard?view=board&owner=desk%3Aphoto"
    )

    await user.click(trigger())
    await user.click(
      await screen.findByRole("option", { name: "All articles" })
    )
    expect(push).toHaveBeenLastCalledWith(
      "/dashboard?view=board&owner=articles"
    )
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <BoardOwnerFilter owners={OWNERS} value="all" />
    )

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
