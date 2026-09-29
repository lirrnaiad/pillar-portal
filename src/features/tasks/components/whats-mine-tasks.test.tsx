// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { TaskCardData, WhatsMine } from "../queries"
import { WhatsMineTasks } from "./whats-mine-tasks"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { respondToSlotAction } = vi.hoisted(() => ({
  respondToSlotAction: vi.fn(),
}))

vi.mock("../actions", () => ({ respondToSlotAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const card = (n: number, title: string): TaskCardData => ({
  id: `00000000-0000-4000-8000-00000000002${n}`,
  title,
  ownerName: "Layout",
  dueAt: "2026-10-31T15:30:00+00:00",
  column: "to_do",
  overdue: false,
  hasAwaitingResponse: false,
  hasNeedsReassignment: false,
  assignees: [],
})

const WHATS_MINE: WhatsMine = {
  waiting: [
    {
      slotId: "00000000-0000-4000-8000-000000000031",
      roleLabel: "Layout Artist",
      respondable: true,
      task: card(1, "Lay out the spread"),
    },
    {
      slotId: "00000000-0000-4000-8000-000000000032",
      roleLabel: "Cartoonist",
      respondable: false,
      task: card(1, "Lay out the spread"),
    },
  ],
  tasks: [card(2, "Draw the strip")],
}

describe("WhatsMineTasks", () => {
  it("shows a Waiting for you section with a count, one item per slot", () => {
    render(<WhatsMineTasks whatsMine={WHATS_MINE} focusTargetId="h1" />)

    expect(
      screen.getByRole("heading", { level: 2, name: "Waiting for you (2)" })
    ).toBeInTheDocument()
    expect(screen.getByText("Your slot: Layout Artist")).toBeInTheDocument()
    expect(screen.getByText("Your slot: Cartoonist")).toBeInTheDocument()
  })

  it("offers the answer buttons only for a respondable slot, named for its role and task", () => {
    render(<WhatsMineTasks whatsMine={WHATS_MINE} focusTargetId="h1" />)

    expect(screen.getAllByRole("button", { name: /I'm on it/ })).toHaveLength(1)
    expect(
      screen.getByRole("button", {
        name: /^I'm on it ?\(Layout Artist, Lay out the spread\)$/,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: /^Can't take this ?\(Layout Artist, Lay out the spread\)$/,
      })
    ).toBeInTheDocument()
  })

  it("moves focus to the focus target once an answer is saved, and keeps it there when the item leaves", async () => {
    const user = userEvent.setup()
    respondToSlotAction.mockResolvedValue({
      ok: true,
      data: { state: "on_it" },
    })
    // The page's h1, then the list, as What's mine renders them.
    function Page({ whatsMine }: { whatsMine: WhatsMine }) {
      return (
        <>
          <h1 id="whats-mine-heading" tabIndex={-1}>
            What&apos;s mine
          </h1>
          <WhatsMineTasks
            whatsMine={whatsMine}
            focusTargetId="whats-mine-heading"
          />
        </>
      )
    }
    const { rerender } = render(<Page whatsMine={WHATS_MINE} />)
    const heading = screen.getByRole("heading", { level: 1 })

    await user.click(screen.getByRole("button", { name: /^I'm on it/ }))

    await waitFor(() => expect(heading).toHaveFocus())
    // Revalidation moves the task to My tasks and drops the Waiting item.
    rerender(
      <Page
        whatsMine={{
          waiting: WHATS_MINE.waiting.slice(1),
          tasks: [WHATS_MINE.waiting[0].task, ...WHATS_MINE.tasks],
        }}
      />
    )
    expect(heading).toHaveFocus()
  })

  it("shows a My tasks section with a count", () => {
    render(<WhatsMineTasks whatsMine={WHATS_MINE} focusTargetId="h1" />)

    const section = screen
      .getByRole("heading", { level: 2, name: "My tasks (1)" })
      .closest("section")!
    expect(
      within(section).getByRole("link", { name: "Draw the strip" })
    ).toBeInTheDocument()
  })

  it("omits an empty section", () => {
    render(
      <WhatsMineTasks
        whatsMine={{ waiting: [], tasks: WHATS_MINE.tasks }}
        focusTargetId="h1"
      />
    )

    expect(screen.queryByText(/Waiting for you/)).not.toBeInTheDocument()
    expect(screen.getByText("My tasks (1)")).toBeInTheDocument()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <WhatsMineTasks whatsMine={WHATS_MINE} focusTargetId="h1" />
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
