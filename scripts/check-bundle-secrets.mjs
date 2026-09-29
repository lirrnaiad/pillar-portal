// Fails when build output that reaches the browser contains a Supabase secret
// key (`sb_secret_` followed by 16+ key characters) or the value of any
// server-only environment variable (AD-6). The key is matched by shape, not by
// its bare prefix: supabase-js's own source holds `startsWith("sb_secret_")`,
// which any client bundle importing the browser client carries.
//
// Scans .next/static/** and the prerendered .next/server/app/**/*.{html,rsc,body}
// (`.body` is a prerendered route-handler response, e.g. favicon.ico.body).
// The server-only variables are the keys of `serverEnvSchema`; values shorter
// than 8 characters are skipped so flags such as `true` can't match by chance.
// Keys that are unset or empty are listed as not scanned. CI sets a canary
// value for each server-only variable before building, so under CI=true an
// unset key is a missing canary and fails the check.
//
// Run with `node --conditions=react-server` so `server-only` resolves.
//
// Usage: node --conditions=react-server scripts/check-bundle-secrets.mjs [--root <dir>]
//   --root  project root holding .next/ and src/lib/env.server.ts (default:
//           this repo; tests point it at a temp-dir fixture)
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({ options: { root: { type: "string" } } })
const ROOT = path.resolve(args.root ?? path.join(import.meta.dirname, ".."))

const { serverEnvSchema } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "env.server.ts")).href
)

const NEXT_DIR = path.join(ROOT, ".next")
const MIN_VALUE_LENGTH = 8
const PRERENDERED = [".html", ".rsc", ".body"]
const IN_CI = process.env.CI === "true"

// A secret key is tested against the file's bytes read as latin1, which maps
// bytes one-to-one and so is safe on any file. Server-only variable values
// stay literal byte matches.
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{16,}/
const needles = [
  {
    label: "sb_secret_ followed by 16+ key characters (a Supabase secret key)",
    pattern: SECRET_KEY_PATTERN,
  },
]
const skipped = []
const unset = []
for (const name of Object.keys(serverEnvSchema.shape)) {
  const value = process.env[name]
  if (value === undefined || value === "") {
    unset.push(name)
    continue
  }
  if (value.length < MIN_VALUE_LENGTH) {
    skipped.push(name)
    continue
  }
  needles.push({ label: name, value })
}

async function exists(dir) {
  try {
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

if (!(await exists(NEXT_DIR))) {
  console.error("check:bundle: .next not found. Run `pnpm build` first.")
  process.exit(1)
}

const targets = []
const staticDir = path.join(NEXT_DIR, "static")
if (await exists(staticDir)) {
  for await (const file of walk(staticDir)) targets.push(file)
}
const serverAppDir = path.join(NEXT_DIR, "server", "app")
if (await exists(serverAppDir)) {
  for await (const file of walk(serverAppDir)) {
    if (PRERENDERED.some((ext) => file.endsWith(ext))) targets.push(file)
  }
}

if (targets.length === 0) {
  console.error(
    "check:bundle: no build output to scan. Run `pnpm build` first."
  )
  process.exit(1)
}

const findings = []
for (const file of targets) {
  const bytes = await readFile(file)
  const text = bytes.toString("latin1")
  for (const needle of needles) {
    const found = needle.pattern
      ? needle.pattern.test(text)
      : bytes.includes(needle.value)
    if (found) {
      findings.push(`${path.relative(ROOT, file)}: contains ${needle.label}`)
    }
  }
}

const unsetLine =
  unset.length > 0
    ? `check:bundle: not scanned (unset or empty): ${unset.join(", ")}`
    : undefined

if (findings.length > 0) {
  console.error("Server-only secrets found in browser-facing build output:")
  for (const finding of findings) console.error(`  ${finding}`)
}
if (unsetLine && IN_CI) {
  console.error(unsetLine)
  console.error(
    `check:bundle: CI must set a canary value (${MIN_VALUE_LENGTH}+ characters) for each server-only variable.`
  )
}
if (findings.length > 0 || (unsetLine && IN_CI)) process.exit(1)

const checked = needles.map((needle) => needle.label).join(", ")
console.log(
  `check:bundle: scanned ${targets.length} files for ${checked}; clean`
)
if (skipped.length > 0) {
  console.log(
    `check:bundle: skipped values under ${MIN_VALUE_LENGTH} characters: ${skipped.join(", ")}`
  )
}
if (unsetLine) console.log(unsetLine)
