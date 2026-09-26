import { ESLint, type Linter } from "eslint"
import { afterEach, describe, expect, it } from "vitest"

import { createConfig } from "./eslint.config.mjs"
import { type Fixture, makeFixture } from "./scripts/test-fixture"

// Lints fixture projects in a temp dir with the real config, pointed at the
// fixture root, so a broken zone glob or resolver setting fails CI.
const FIXTURE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: "esnext",
    moduleResolution: "bundler",
    paths: { "@/*": ["./src/*"] },
  },
  include: ["**/*.ts"],
})

let fixture: Fixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

async function lint(
  files: Record<string, string>,
  target: string
): Promise<Linter.LintMessage[]> {
  fixture = makeFixture({ "tsconfig.json": FIXTURE_TSCONFIG, ...files })
  const eslint = new ESLint({
    cwd: fixture.root,
    overrideConfigFile: true,
    overrideConfig: [
      ...createConfig(fixture.root),
      // The fixture has no node_modules for eslint-plugin-react to detect.
      { settings: { react: { version: "19.3" } } },
    ],
  })
  const [result] = await eslint.lintFiles([target])
  return result.messages
}

const rules = (messages: Linter.LintMessage[]) =>
  messages.map((message) => message.ruleId)

describe("eslint architecture rules", { timeout: 30_000 }, () => {
  it("reports a process.env read in src/foo.ts", async () => {
    const messages = await lint(
      { "src/foo.ts": "export const x = process.env.FOO\n" },
      "src/foo.ts"
    )
    expect(rules(messages)).toContain("no-restricted-properties")
  })

  it("reports process aliased past the process.env rule", async () => {
    const messages = await lint(
      { "src/foo.ts": "const p = process\nexport const x = p.env.FOO\n" },
      "src/foo.ts"
    )
    expect(rules(messages)).toContain("no-restricted-globals")
  })

  it("reports a two-file import cycle", async () => {
    const messages = await lint(
      {
        "src/lib/a.ts": 'import { b } from "./b"\nexport const a = () => b\n',
        "src/lib/b.ts": 'import { a } from "./a"\nexport const b = () => a\n',
      },
      "src/lib/a.ts"
    )
    expect(rules(messages)).toContain("import/no-cycle")
  })

  it("reports a deep @/features/tasks/x import", async () => {
    const messages = await lint(
      {
        "src/features/tasks/index.ts": 'export { x } from "./x"\n',
        "src/features/tasks/x.ts": "export const x = 1\n",
        "src/lib/deep.ts":
          'import { x } from "@/features/tasks/x"\nexport const d = x\n',
      },
      "src/lib/deep.ts"
    )
    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import/no-restricted-paths",
        message: expect.stringContaining("through its index.ts only"),
      })
    )
  })

  it("reports members importing tasks", async () => {
    const messages = await lint(
      {
        "src/features/tasks/index.ts": "export const t = 1\n",
        "src/features/members/index.ts":
          'import { t } from "@/features/tasks"\nexport const m = t\n',
      },
      "src/features/members/index.ts"
    )
    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import/no-restricted-paths",
        message: expect.stringContaining(
          "members slice imports no other slice"
        ),
      })
    )
  })

  it("reports src/lib importing src/app", async () => {
    const messages = await lint(
      {
        "src/app/api/health/route.ts": "export const GET = () => null\n",
        "src/lib/uses-app.ts":
          'import { GET } from "@/app/api/health/route"\nexport const g = GET\n',
      },
      "src/lib/uses-app.ts"
    )
    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import/no-restricted-paths",
        message: expect.stringContaining("Only src/app may import src/app"),
      })
    )
  })

  it("allows tasks to import members through its index.ts", async () => {
    const messages = await lint(
      {
        "src/features/members/index.ts": "export const m = 1\n",
        "src/features/tasks/index.ts":
          'import { m } from "@/features/members"\nexport const t = m\n',
      },
      "src/features/tasks/index.ts"
    )
    expect(messages).toEqual([])
  })

  it("reports importing cn from the package instead of @/lib/utils", async () => {
    const messages = await lint(
      {
        "src/components/x.ts": 'import { cn } from "cn"\nexport const c = cn\n',
      },
      "src/components/x.ts"
    )
    expect(rules(messages)).toContain("no-restricted-imports")
  })

  it("throws at config load for a src/features folder that is not a slice", () => {
    fixture = makeFixture({ "src/features/widgets/index.ts": "export {}\n" })
    expect(() => createConfig(fixture!.root)).toThrow(
      /src\/features\/widgets is not an AD-2 slice/
    )
  })
})
