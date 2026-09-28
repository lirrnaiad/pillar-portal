# The Pillar Portal

Internal management and applicant-intake portal for The Pillar, a university
student publication. Next.js 16 (App Router) with Tailwind 4 and shadcn/ui,
deployed on Vercel in `sin1`, over Supabase (Postgres 17) in Singapore.

## Setup

Requires Node 24, pnpm 12 (`corepack enable` picks up the version pinned in
`package.json`) and Docker for the local Supabase stack.

```bash
pnpm install
cp .env.example .env.local
pnpm exec supabase start
pnpm dev
```

The app runs at http://localhost:3000, and `GET /api/health` returns
`{"status":"ok","timestamp":"..."}`. `/login` offers the prototype personas,
and `/dashboard` is the member area.

`.env.example` holds working local values. `next dev`, `next build` and
`next start` stop with the variable named when a `NEXT_PUBLIC_*` value is
missing or malformed, and the server refuses to start when a server-only one
is:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | The site's http(s) URL |
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase API URL: `http://127.0.0.1:54321` locally |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | A publishable key (`sb_publishable_...`); a secret key or a legacy JWT key is refused. `.env.example` holds the local stack's fixed demo key |
| `PROTOTYPE_PERSONAS` | Server-only, optional. `true` turns on persona sign-in; unset or `false` leaves it off. It may be `true` only when `NEXT_PUBLIC_SUPABASE_URL` is the local stack (`localhost` or `127.0.0.1`) or the staging project |
| `PROTOTYPE_PERSONA_PASSWORD` | Server-only, at least 16 characters; required when personas are on. Locally it must match `supabase/seed.sql` (`.env.example` has the value); staging's is generated and set on Vercel |

### Prototype personas

While `PROTOTYPE_PERSONAS=true`, `/login` shows three buttons: **Staff Layout
Artist**, **Head Layout Artist** and **Editor-in-Chief**. Each signs in as a
shared Supabase Auth user (`src/features/members/personas.ts`) with the
password only the server holds, under the same RLS as any member. Sign out
ends only that browser's session, so others using the same persona stay
signed in. Self sign-up is off in `supabase/config.toml`, so every account is
a persona or a seeded member.

Staging is public by design: anyone who opens the staging URL can sign in as
any persona, including the Editor-in-Chief. So staging holds synthetic data
only, and real member data never goes there.

### Local Supabase

The Supabase CLI is a dev dependency, so run it as `pnpm exec supabase`.
`supabase start` runs the whole stack in Docker (API on port 54321, Postgres
on 54322) and applies `supabase/migrations/`; `supabase stop` stops it.
`supabase db start` starts only the database, which is enough for the database
checks below.

The CLI uses the current Docker context. If that context's published ports
don't reach 127.0.0.1 (rootless Docker can do this, which shows up as
`ECONNREFUSED 127.0.0.1:54322`), point the CLI at a daemon whose ports do with
`DOCKER_HOST` in that shell, rather than changing the Docker context:

```bash
export DOCKER_HOST=unix:///var/run/docker.sock   # fish: set -x DOCKER_HOST ...
```

Migrations are named `<timestamp>_<slice>_<change>.sql`
(`pnpm exec supabase migration new <slice>_<change> </dev/null`; without a
terminal the command waits for SQL on stdin). `<slice>` is one of the six
slices (`members`, `tasks`, `reports`, `recruitment`, `email`, `files`), or
`core` for cross-cutting migrations such as the security baseline and the
sections, desks and positions data. The first, `core_security_baseline`,
turns off Supabase's default grants to `anon` and `authenticated`, so every
object a later migration adds starts with no API access and gets only the
grants it names.

`supabase db reset` applies the migrations, then `supabase/seed.sql`: the
three personas (with the local persona password) and 14 synthetic members
with no password, covering every desk and every approver path. It creates
auth users only; a trigger turns each into a pending member, and the seed
then sets names and positions, which set the role. Running it again changes
nothing. `members.role` always follows the positions held: none is
`pending`, only Staff positions is `staff`, any Board position is
`editorial_admin`.

### Schema to hosted Supabase

The schema changes only through `supabase/migrations`, never by dashboard
edits, and each migration stays backward-compatible for one deploy (AD-17).
Link a project once, then push its migrations before the deploy that needs
them:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

Staging's `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set on the Vercel project, not in
this repository, as are `PROTOTYPE_PERSONAS` and `PROTOTYPE_PERSONA_PASSWORD`.

Auth settings live in `supabase/config.toml` (`[auth]`, with the staging
Site URL and redirect in `[remotes.staging]`). Check what would change with
`pnpm exec supabase config diff` before `pnpm exec supabase config push`.

### Staging personas

Migrations never create personas. After `db push`, create or update them on
staging with:

```bash
node scripts/staging-personas.mjs
```

It reads `.env.staging.local` (git-ignored, mode 0600) holding
`STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SECRET_KEY` (an `sb_secret_` key)
and `PROTOTYPE_PERSONA_PASSWORD` (the value also set on Vercel, never the
local one). Before any network or CLI call it refuses unless all three are
valid, none is already set in the shell, and the CLI is linked to staging.
It then checks the migrations are there ("run db push first"), creates or
updates each persona through the Auth admin API, and runs
`supabase/seed.sql` on the linked project for the synthetic members, which
skips the personas. Last, it exits 1 if any staging user has the committed
local persona password. The Supabase CLI it spawns never sees the key or the
password. It prints counts only, and running it again changes nothing.

## Checks

CI runs these in order on every pull request and on pushes to `main`, and a
failing step blocks the merge:

| Command | What it checks |
|---|---|
| `pnpm lint` | ESLint, including the architecture rules: only `src/lib/env.server.ts` and `src/lib/env.client.ts` use `process`; no `getSession` anywhere under `src/` (server code gets the caller from `supabase.auth.getClaims()`); no import cycles; slices under `src/features/` are imported only through their `index.ts`; `members`, `files` and `email` import no other slice, and `tasks`, `reports` and `recruitment` may import only `members`, `files` and `email`; nothing outside `src/app` imports `src/app`; only `src/lib/utils.ts` imports the `cn` package (everything else uses `cn` from `@/lib/utils`) |
| `pnpm typecheck` | `next typegen`, then `tsc --noEmit` |
| `pnpm check:hex` | No hex color in any file under `src/` except `src/app/globals.css`, which holds the design tokens |
| `pnpm test` | Vitest: unit tests, component tests in jsdom with an axe accessibility check, plus tests that run the lint config and the two check scripts against temp-dir fixture projects |
| `pnpm exec supabase db start`, then `pnpm exec supabase db reset` | The migrations apply cleanly to a fresh database |
| `pnpm exec supabase test db` | pgTAP: the catalog test in `supabase/tests/00_security/` (see below), the org reference data in `supabase/tests/core/` (the rows, and that re-running the data migration restores them), and members in `supabase/tests/members/` (the new-user trigger, role derivation, constraints, and a table-driven caller matrix of helper results and RLS visibility) |
| `pnpm db:types && git diff --exit-code -- src/lib/supabase/database.types.ts` | The committed types match the schema. Run `pnpm db:types` after any schema change and commit the result; Prettier leaves the file alone |
| `pnpm build` | Production build |
| `pnpm check:bundle` | Browser-facing build output (`.next/static`, and prerendered `.html`, `.rsc` and `.body` files) contains no Supabase secret key and no server-only env value of 8+ characters; run after `pnpm build`. Unset server-only variables are listed as not scanned, and under `CI=true` they fail the check (every server-only variable needs a canary value in CI) |

To run the whole gate locally:

```bash
pnpm lint && pnpm typecheck && pnpm check:hex && pnpm test
pnpm exec supabase db start && pnpm exec supabase db reset && pnpm exec supabase test db
pnpm db:types && git diff --exit-code -- src/lib/supabase/database.types.ts
pnpm build && pnpm check:bundle
```

### The catalog test

`supabase/tests/00_security/catalog.test.sql` checks the `public` and `private`
schemas and fails, naming the object, when:

1. `anon` holds any privilege on either schema or anything in it (grants to
   PUBLIC count).
2. `authenticated` holds CREATE on either schema, more than SELECT on a
   `public` table or view, or anything on a `private` table or view or on any
   sequence.
3. A `public` table doesn't have row level security enabled, or `public` holds
   a materialized view or foreign table (neither can have RLS).
4. A `security definer` function doesn't `set search_path = ''`.
5. A view isn't `security_invoker` (`public.member_directory` is the one
   exception).
6. A function's EXECUTE grants differ from `function-grants.txt`. The failure
   lists the extra and missing lines. The test also fails if it can't read
   the file.
7. A Storage bucket is public.
8. The `supabase_realtime` publication differs from the expected list at the
   top of the test, is missing, or publishes all tables.

It also checks that pg_graphql is not installed. A self-test then creates a
violation for every branch of every check and asserts each is reported, and
asserts that allowed objects (a `security definer` function with an empty
`search_path`, a `security_invoker` view, `public.member_directory`) are not.

Two lists change with the schema, in the same commit as the migration:

- **`supabase/tests/00_security/function-grants.txt`**: one line per EXECUTE
  grant, `<grantee> <schema>.<function>(<argument types>)`, such as
  `authenticated public.task_capabilities(uuid[])`. Use `public` for PUBLIC,
  and write argument types as Postgres prints them (runs of whitespace count
  as one space). When check 6 fails, its
  extra and missing lines are the lines to add or remove.
- **`expected_realtime_tables`** in `catalog.test.sql`: the tables the
  migration adds to the `supabase_realtime` publication.

## Security headers

`next.config.ts` sends these on every route, pages and route handlers alike
(built by `src/lib/security-headers.ts`):

- A static `Content-Security-Policy` that allows only this site and the
  Supabase origin, with `frame-ancestors 'none'`. The Supabase origin is
  allowed in `connect-src` (`https` plus `wss` for Realtime on hosted
  projects; `http` and `ws` for the local stack) and in `img-src`. Scripts and
  styles allow `'unsafe-inline'`, and `next dev` adds `'unsafe-eval'`.
  Previews block the Vercel toolbar.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`

## Layout

- `src/app/` routes: `(auth)/login`, the `(member)` layout and `dashboard`,
  and `api/health`
- `src/features/members/` the members slice: personas, the sign-in and
  sign-out actions, `getCurrentMember()`, the persona buttons and the avatar
  menu
- `src/components/app-header.tsx` the navy header with the logo and wordmark
- `src/lib/` shared code, including the two env modules and the security
  headers
- `src/lib/supabase/` the server client (`server.ts`), the browser client
  (`client.ts`) and the generated `database.types.ts`
- `src/components/ui/` shadcn components
- `src/instrumentation.ts` validates the env modules when the server starts
- `supabase/` the CLI config, migrations, `seed.sql` and pgTAP tests
- `scripts/` the `check:hex` and `check:bundle` scripts, and
  `staging-personas.mjs`
