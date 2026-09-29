import { afterEach, describe, expect, it } from "vitest"

import { type Fixture, makeFixture, runScript } from "./test-fixture"

// Each fixture brings its own src/lib/env.server.ts, so these tests don't
// depend on the real server variables or their validation. The scan reads
// only `serverEnvSchema.shape`.
const FIXTURE_ENV_SERVER = `export const serverEnvSchema = {
  shape: { PILLAR_TEST_SECRET: {}, PILLAR_TEST_FLAG: {} },
}
`

const CANARY = "canary-server-value-1234"
const OTHER_CANARY = "canary-server-flag-5678"

let fixture: Fixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

function checkBundle(
  files: Record<string, string>,
  env: Record<string, string> = {}
) {
  fixture = makeFixture({
    "package.json": '{ "type": "module" }\n',
    "src/lib/env.server.ts": FIXTURE_ENV_SERVER,
    ...files,
  })
  return runScript("check-bundle-secrets.mjs", fixture.root, {
    nodeArgs: ["--conditions=react-server"],
    env,
  })
}

describe("check:bundle", () => {
  it("fails when .next/static contains a Supabase secret key, naming the file", () => {
    // sb_secret_ plus 31 characters, the shape of a real key. Built at
    // runtime so no key-shaped literal sits in the source (GitHub's push
    // protection would block it as a Supabase secret).
    const result = checkBundle({
      ".next/static/chunks/app.js":
        'const key = "sb_secret_' + "0123456789abcdefghijklmnopqrstu" + '"\n',
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      ".next/static/chunks/app.js: contains sb_secret_"
    )
  })

  it("passes a bundle that only tests for the prefix, as supabase-js does", () => {
    const result = checkBundle({
      ".next/static/chunks/app.js":
        'let ni=t=>t.startsWith("sb_publishable_")||t.startsWith("sb_secret_")\n',
    })

    expect(result.status).toBe(0)
  })

  it("fails on a key at the pattern's 16-character minimum, and passes one short of it", () => {
    const at = checkBundle({
      ".next/static/chunks/app.js": 'k="sb_secret_' + "a".repeat(16) + '"\n',
    })
    expect(at.status).toBe(1)

    const under = checkBundle({
      ".next/static/chunks/app.js": 'k="sb_secret_' + "a".repeat(15) + '"\n',
    })
    expect(under.status).toBe(0)
  })

  it.each([
    ".next/static/chunks/app.js",
    ".next/server/app/index.html",
    ".next/server/app/dashboard/page.rsc",
    ".next/server/app/favicon.ico.body",
  ])(
    "fails when a server-only value of 8+ characters is in %s, naming the file and the variable",
    (leaked) => {
      const result = checkBundle(
        {
          ".next/static/chunks/clean.js": "console.log(1)\n",
          [leaked]: `<p>${CANARY}</p>\n`,
        },
        { PILLAR_TEST_SECRET: CANARY }
      )

      expect(result.status).toBe(1)
      expect(result.output).toContain(`${leaked}: contains PILLAR_TEST_SECRET`)
    }
  )

  it("skips server-only values under 8 characters", () => {
    const result = checkBundle(
      { ".next/static/chunks/app.js": "const on = true; const s = 'short'\n" },
      { PILLAR_TEST_SECRET: "short", PILLAR_TEST_FLAG: "true" }
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain(
      "skipped values under 8 characters: PILLAR_TEST_SECRET, PILLAR_TEST_FLAG"
    )
  })

  it("scans only static output and prerendered .html/.rsc/.body under .next/server/app", () => {
    const result = checkBundle(
      {
        ".next/static/chunks/app.js": "console.log(1)\n",
        ".next/server/app/api/health/route.js": `const v = "${CANARY}"\n`,
      },
      { PILLAR_TEST_SECRET: CANARY, PILLAR_TEST_FLAG: OTHER_CANARY }
    )

    expect(result.status).toBe(0)
  })

  it("lists unset or empty server-only keys as not scanned and passes outside CI", () => {
    const result = checkBundle(
      { ".next/static/chunks/app.js": "console.log(1)\n" },
      { PILLAR_TEST_FLAG: "" }
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain(
      "not scanned (unset or empty): PILLAR_TEST_SECRET, PILLAR_TEST_FLAG"
    )
  })

  it("fails under CI=true when a server-only key has no canary, naming it", () => {
    const result = checkBundle(
      { ".next/static/chunks/app.js": "console.log(1)\n" },
      { CI: "true", PILLAR_TEST_SECRET: CANARY }
    )

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "not scanned (unset or empty): PILLAR_TEST_FLAG"
    )
    expect(result.output).not.toContain("PILLAR_TEST_SECRET")
  })

  it("passes under CI=true when every server-only key has a canary", () => {
    const result = checkBundle(
      { ".next/static/chunks/app.js": "console.log(1)\n" },
      { CI: "true", PILLAR_TEST_SECRET: CANARY, PILLAR_TEST_FLAG: OTHER_CANARY }
    )

    expect(result.status).toBe(0)
    expect(result.output).not.toContain("not scanned")
  })

  it("fails when .next exists but holds nothing scannable", () => {
    const result = checkBundle({
      ".next/BUILD_ID": "build-1\n",
      ".next/server/app/api/health/route.js": "export {}\n",
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain("no build output to scan")
  })

  it("fails when .next is missing", () => {
    const result = checkBundle({})

    expect(result.status).toBe(1)
    expect(result.output).toContain(".next not found")
  })
})
