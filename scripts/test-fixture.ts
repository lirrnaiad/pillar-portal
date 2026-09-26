// Temp-dir project fixtures for the check-script tests. Nothing here touches
// the real src/ or .next/.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type Fixture = { root: string; cleanup: () => void }

/** Creates a temp project root holding `files` (relative path → contents). */
export function makeFixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "pillar-check-"))
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/**
 * Runs a check script as `pnpm` would, against `root`, with only `env` (plus
 * NODE_ENV) in the environment so nothing ambient can change the result.
 */
export function runScript(
  script: string,
  root: string,
  {
    nodeArgs = [],
    env = {},
  }: { nodeArgs?: string[]; env?: Record<string, string> } = {}
) {
  const result = spawnSync(
    process.execPath,
    [...nodeArgs, path.join(import.meta.dirname, script), "--root", root],
    {
      encoding: "utf8",
      env: { ...env, NODE_ENV: "test" },
      // spawnSync blocks the worker, so Vitest's own timeout can't fire.
      timeout: 30_000,
    }
  )
  if (result.error) {
    throw new Error(`${script} did not run to completion`, {
      cause: result.error,
    })
  }
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  }
}
