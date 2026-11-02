import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

// The undo-a-decline statement has two copies: the ```sql block under
// "### Undoing a mistaken decline" in OPERATIONS.md, which the database owner
// runs, and the `$statement$…$statement$` literal in
// supabase/tests/members/undo_decline.test.sql, which pgTAP runs. pgTAP only
// proves its own copy, so this fails when the runbook's drifts from it.

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8")

const operations = read("../../../OPERATIONS.md")
const pgTap = read("../../../supabase/tests/members/undo_decline.test.sql")

function runbookStatement(): string | undefined {
  const heading = "### Undoing a mistaken decline\n"
  const start = operations.indexOf(heading)
  if (start === -1) return undefined
  // The subsection runs to the next heading of any level.
  const rest = operations.slice(start + heading.length)
  const end = rest.search(/^#/m)
  const subsection = end === -1 ? rest : rest.slice(0, end)
  return /^```sql\n([\s\S]*?)^```$/m.exec(subsection)?.[1]
}

function pgTapStatements(): string[] {
  return [...pgTap.matchAll(/\$statement\$([\s\S]*?)\$statement\$/g)].map(
    (match) => match[1]
  )
}

describe("the undo-a-decline statement", () => {
  it("is in OPERATIONS.md and, once, in undo_decline.test.sql", () => {
    expect(runbookStatement()).toBeDefined()
    expect(pgTapStatements()).toHaveLength(1)
  })

  it("is the same in both", () => {
    expect(runbookStatement()?.trim()).toBe(pgTapStatements()[0]?.trim())
  })

  it("holds the '<email>' placeholder the pgTAP test swaps, once", () => {
    expect(runbookStatement()?.split("'<email>'")).toHaveLength(2)
  })
})
