// Fails when a hex color appears in any file under src/ other than
// src/app/globals.css, the one home of the DESIGN.md tokens. Components use
// token classes (bg-navy, text-muted-foreground), never raw colors.
//
// Usage: node scripts/check-no-hex.mjs [--root <dir>] [dir ...]
//   --root  project root to scan and report paths from (default: this repo;
//           tests point it at a temp-dir fixture)
//   dir     directories under the root to scan (default: src)
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

const { values: args, positionals: dirs } = parseArgs({
  options: { root: { type: "string" } },
  allowPositionals: true,
})
const ROOT = path.resolve(args.root ?? path.join(import.meta.dirname, ".."))
const EXEMPT = new Set(["src/app/globals.css"])

// #rgb, #rgba, #rrggbb, #rrggbbaa, not part of a longer word and not an
// HTML numeric character reference (&#123;).
const HEX_COLOR =
  /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

const findings = []

for (const dir of dirs.length > 0 ? dirs : ["src"]) {
  for await (const file of walk(path.resolve(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    if (EXEMPT.has(rel)) continue

    const bytes = await readFile(file)
    // Skip binary files (favicon, images): a NUL byte in the first 8 KB.
    if (bytes.subarray(0, 8192).includes(0)) continue

    const lines = bytes.toString("utf8").split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(HEX_COLOR)) {
        findings.push(`${rel}:${index + 1}: ${match[0]}`)
      }
    })
  }
}

if (findings.length > 0) {
  console.error("Hex colors found outside src/app/globals.css:")
  for (const finding of findings) console.error(`  ${finding}`)
  console.error(
    "Use a DESIGN.md token class instead, or add the token to src/app/globals.css."
  )
  process.exit(1)
}

console.log("check:hex: no hex colors outside src/app/globals.css")
