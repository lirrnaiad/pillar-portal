import { afterEach, describe, expect, it } from "vitest"

import { type Fixture, makeFixture, runScript } from "./test-fixture"

let fixture: Fixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

function checkHex(files: Record<string, string>) {
  fixture = makeFixture(files)
  return runScript("check-no-hex.mjs", fixture.root)
}

describe("check:hex", () => {
  it("fails on a hex color in src/x.tsx and prints file:line", () => {
    const result = checkHex({
      "src/x.tsx": 'export const navy = "#07253F"\n',
      "src/app/globals.css": ":root { --color-navy: #07253F; }\n",
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain("src/x.tsx:1")
    expect(result.output).not.toContain("globals.css:1")
  })

  it.each(["#fff", "#abcd", "#07253fcc"])(
    "fails on the %s form of a hex color and prints file:line",
    (hex) => {
      const result = checkHex({
        "src/x.tsx": `export const a = 1\nexport const color = "${hex}"\n`,
      })

      expect(result.status).toBe(1)
      expect(result.output).toContain(`src/x.tsx:2: ${hex}`)
    }
  )

  it("exempts src/app/globals.css", () => {
    const result = checkHex({
      "src/app/globals.css": ":root { --color-navy: #07253F; }\n",
      "src/app/page.tsx": 'export const cls = "bg-navy text-white"\n',
    })

    expect(result.status).toBe(0)
  })

  it("ignores # that is not a color (anchors, character references)", () => {
    const result = checkHex({
      "src/app/page.tsx":
        'export const a = "#main"\nexport const b = "&#123;"\n',
    })

    expect(result.status).toBe(0)
  })
})
