// Creates or updates the prototype personas and the synthetic members on the
// staging Supabase project (AD-7, AD-17). Run it from your machine, never in
// CI, after `supabase db push`:
//
//   node scripts/staging-personas.mjs [--root <dir>]
//     --root  project root holding .env.staging.local and the CLI's
//             supabase/.temp/project-ref (default: this repo; tests point it
//             at a temp-dir fixture)
//
// It reads .env.staging.local (git-ignored, mode 0600), which holds:
//
//   STAGING_SUPABASE_URL=https://sxlgelitcaolpiijfwsq.supabase.co
//   STAGING_SUPABASE_SECRET_KEY=sb_secret_...
//   PROTOTYPE_PERSONA_PASSWORD=<generated, 16+ characters; also set on Vercel>
//
// Every input is checked before any network or CLI call. Then:
//
// 1. `supabase db query --linked` confirms the migrations are there
//    (`public.members` exists), or it stops with "run db push first".
// 2. Each persona in src/features/members/personas.ts is created through the
//    Auth admin API (email confirmed, `full_name` metadata) or, if its email
//    already exists, given the password, metadata and confirmation again.
// 3. `supabase db query --linked -f supabase/seed.sql` adds the synthetic
//    members and sets every seeded member's name and positions. The personas
//    already exist, so seed.sql skips creating them.
// 4. It checks that no staging user has the committed local persona password
//    and exits 1 if any does.
//
// Running it again changes nothing. It prints counts only, never the key or
// the password, and the Supabase CLI it spawns never sees either.
import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"

import { createClient } from "@supabase/supabase-js"

import { PERSONAS } from "../src/features/members/personas.ts"

const { values: args } = parseArgs({ options: { root: { type: "string" } } })
const ROOT = path.resolve(args.root ?? path.join(import.meta.dirname, ".."))

const STAGING_REF = "sxlgelitcaolpiijfwsq"
const STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`
const ENV_FILE = path.join(ROOT, ".env.staging.local")
const PROJECT_REF_FILE = path.join(ROOT, "supabase", ".temp", "project-ref")
const NAMES = [
  "STAGING_SUPABASE_URL",
  "STAGING_SUPABASE_SECRET_KEY",
  "PROTOTYPE_PERSONA_PASSWORD",
]
// The password supabase/seed.sql gives the local personas (and .env.example
// holds). It is public, so it must never be live on staging.
const LOCAL_PERSONA_PASSWORD = "local-persona-password"

function refuse(message) {
  console.error(`staging-personas: ${message}`)
  process.exit(1)
}

// process.loadEnvFile() never overrides a variable that is already set, so a
// value exported in the shell would silently win over the file.
const preset = NAMES.filter((name) => process.env[name] !== undefined)
if (preset.length > 0) {
  refuse(
    `unset ${preset.join(", ")} in this shell; the values come from .env.staging.local only.`
  )
}

let mode
try {
  mode = statSync(ENV_FILE).mode
} catch {
  refuse(`.env.staging.local not found in ${ROOT} (see this script's header).`)
}
if ((mode & 0o077) !== 0) {
  refuse("run `chmod 600 .env.staging.local` first.")
}
process.loadEnvFile(ENV_FILE)

const url = process.env.STAGING_SUPABASE_URL ?? ""
const secretKey = process.env.STAGING_SUPABASE_SECRET_KEY ?? ""
const password = process.env.PROTOTYPE_PERSONA_PASSWORD ?? ""

if (!URL.canParse(url) || new URL(url).origin !== STAGING_ORIGIN) {
  refuse(`STAGING_SUPABASE_URL must be ${STAGING_ORIGIN}.`)
}
if (!secretKey.startsWith("sb_secret_")) {
  refuse("STAGING_SUPABASE_SECRET_KEY must be a secret key (sb_secret_...).")
}
if (password.length < 16) {
  refuse("PROTOTYPE_PERSONA_PASSWORD must be at least 16 characters.")
}
if (password === LOCAL_PERSONA_PASSWORD) {
  refuse(
    "PROTOTYPE_PERSONA_PASSWORD must not be the committed local password; generate one."
  )
}

let linkedRef = ""
try {
  linkedRef = readFileSync(PROJECT_REF_FILE, "utf8").trim()
} catch {
  // Reported below.
}
if (linkedRef !== STAGING_REF) {
  refuse(
    `the Supabase CLI must be linked to staging (${STAGING_REF}); run \`pnpm exec supabase link --project-ref ${STAGING_REF}\`.`
  )
}

// The CLI authenticates with its own login, so it gets none of the three
// values from .env.staging.local.
const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !NAMES.includes(name))
)

function supabaseCli(cliArgs) {
  const label = `\`supabase ${cliArgs.slice(0, 3).join(" ")}\``
  const result = spawnSync("pnpm", ["exec", "supabase", ...cliArgs], {
    cwd: ROOT,
    encoding: "utf8",
    env: cliEnv,
  })
  if (result.error) {
    refuse(`could not run ${label}: ${result.error.message}`)
  }
  if (result.status === null) {
    refuse(`${label} was stopped by ${result.signal ?? "a signal"}.`)
  }
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    refuse(`${label} failed (exit ${result.status}).`)
  }
  return result.stdout
}

// `db query -o json` prints `{ "rows": [...], ... }` (or a bare array),
// possibly after other lines. Parse from the first line that starts JSON to
// the last closing bracket.
function parseRows(output, what) {
  const start = output.search(/^\s*[[{]/m)
  const end = Math.max(output.lastIndexOf("}"), output.lastIndexOf("]"))
  let parsed
  try {
    parsed = JSON.parse(output.slice(start, end + 1))
  } catch {
    parsed = undefined
  }
  if (start === -1 || end < start || parsed === undefined) {
    refuse(`${what}: the CLI didn't print JSON.`)
  }
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows
  if (!Array.isArray(rows)) refuse(`${what}: the CLI's JSON has no rows.`)
  return rows
}

function queryRows(sql, what) {
  return parseRows(
    supabaseCli(["db", "query", "--linked", "-o", "json", sql]),
    what
  )
}

const [schema] = queryRows(
  "select to_regclass('public.members') is not null as ready",
  "checking the schema"
)
if (schema?.ready !== true) {
  refuse("staging has no public.members table; run db push first.")
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
})
if (listError) refuse(`listing users failed: ${listError.message}`)

const idsByEmail = new Map(
  listed.users.map((user) => [user.email?.toLowerCase(), user.id])
)

let created = 0
let updated = 0
for (const [key, persona] of Object.entries(PERSONAS)) {
  const attributes = {
    password,
    email_confirm: true,
    user_metadata: { full_name: persona.name },
  }
  const existingId = idsByEmail.get(persona.email)
  const { error } = existingId
    ? await supabase.auth.admin.updateUserById(existingId, attributes)
    : await supabase.auth.admin.createUser({
        ...attributes,
        email: persona.email,
      })
  if (error) refuse(`persona ${key}: ${error.message}`)
  if (existingId) updated += 1
  else created += 1
}
console.log(`staging-personas: personas created ${created}, updated ${updated}`)

supabaseCli(["db", "query", "--linked", "-f", "supabase/seed.sql"])
console.log("staging-personas: supabase/seed.sql applied")

const counts = queryRows(
  "select role::text as role, count(*)::int as members from public.members group by 1 order by 1",
  "counting members"
)
console.log(
  `staging-personas: members by role: ${counts.map((row) => `${row.role} ${row.members}`).join(", ") || "none"}`
)

const [leak] = queryRows(
  `select count(*)::int as users from auth.users where encrypted_password like '$2%' and encrypted_password = extensions.crypt('${LOCAL_PERSONA_PASSWORD}', encrypted_password)`,
  "checking passwords"
)
if (leak?.users !== 0) {
  refuse(
    `${leak?.users ?? "an unknown number of"} staging user(s) have the committed local persona password; reset them.`
  )
}
console.log("staging-personas: no staging user has the local persona password")
