<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- bmad:context -->
<!-- Verified 2026-10-28 against bdcc8aa. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## The Pillar Portal

Internal portal for The Pillar, a university student publication: a task board for its staff now, then accomplishment reports and recruitment. Next.js 16 App Router on Vercel (`sin1`), Supabase (Postgres 17, Auth, Realtime) in Singapore, Tailwind 4 with shadcn, pnpm. It is built story by story with the BMad Method (`.claude/skills/bmad-*`), whose planning artifacts are local and git-ignored. README covers setup and environment variables; OPERATIONS.md covers production.

## Policy

- This repo is public and holds application code only: never commit `_bmad/`, `_bmad-output/`, `.claude/`, `docs/`, `.env*` other than `.env.example`, `.vercel` or the Elgraine font; keep them in `.gitignore`.
- Never commit `docs/private/` or quote it in a committed file, `OPERATIONS.md` included.
- Never commit an `sb_secret_` value; CI's `sb_secret_ci-canary-not-a-real-key` is the only one. In tests, build key-shaped strings at runtime (`"sb_secret_" + "…"`), since GitHub push protection flags literals.
- Merge PRs into `main` by squash, after the required `ci` check passes.
- Stop for the user's yes, listing the commands, before any `--linked` Supabase command, `supabase config push`, a Supabase or Vercel dashboard or CLI change, `gh secret` or `gh workflow`, and any push to `pillar-portal-backups`.
- After merging a PR that adds a migration, in the same session: `pnpm exec supabase db push --linked` (dry run first), `test db --linked`, then `migration list --linked` showing no local-only version. Staging deploys `main` on merge, so code ahead of its migration breaks it.
- A story stays `review` until its spec's manual checks run (ask first: claude-in-chrome or by hand) and their results are written into the spec; the user moves it to `done`.
- Never add story history, module descriptions or setup steps to CLAUDE.md or this block, and skip any "record Story X in CLAUDE.md" task a spec carries. Add a line here only for a new invariant, a command caveat or a mistake an agent made, through `bmad-project-context`.

## Where things are

- Next story: `_bmad-output/implementation-artifacts/sprint-status.yaml`; specs, `deferred-work.md` and the retros sit beside it. Stories: `_bmad-output/planning-artifacts/epics.md`.
- Product intent: `_bmad-output/planning-artifacts/prds/prd-pillar-portal-2026-08-30/prd.md`. Behavior and copy: `_bmad-output/planning-artifacts/ux-designs/ux-pillar-portal-2026-09-12/EXPERIENCE.md`, with `DESIGN.md` beside it for visual tokens. Invariants AD-1…AD-22: `_bmad-output/planning-artifacts/architecture/architecture-pillar-portal-2026-09-25/ARCHITECTURE-SPINE.md`.
- When they disagree, EXPERIENCE.md beats the PRD on behavior and copy, and the spine beats both on data, commands, security and sequencing. Use their copy verbatim.
- The PRD numbers stories differently: use `epics.md`'s numbers and sprint keys, except when quoting the PRD.
- Touching sections, desks, positions, approvers, personas or member roles? Read `docs/pillar-org-structure.md` first.
- Backups run from the private sibling repo `../pillar-portal-backups`. Bumping the Supabase CLI in `package.json`, or Supabase's Postgres major, means updating its `.github/workflows/backup.yml` (`SUPABASE_CLI_VERSION`/`SUPABASE_CLI_SHA256`, `postgresql-client-17`).

## Running and verifying

- If Docker's published ports don't reach 127.0.0.1 (rootless Docker), prefix Supabase CLI calls and `pnpm db:types` with `DOCKER_HOST=unix:///var/run/docker.sock`; never change the user's Docker context.
- Create migrations with `pnpm exec supabase migration new <slice>_<change> </dev/null` (`<slice>` is one of the six slices or `core`); without the redirect it waits for SQL on stdin. Never hand-write a timestamp, and never rename or edit an applied migration: add a new one.
- Keep `supabase/.temp/project-ref` on staging (`sxlgelitcaolpiijfwsq`); reach any other project with `--db-url` or `--workdir <dir>`, never by relinking the checkout.
- Keep `supabase/seed.sql` one idempotent `DO` block: `supabase db query` rejects two statements in one call.
- Open every pgTAP file with `set local role postgres` and a `search_path` including `extensions`, and never `reset role`: `test db --linked` connects as `cli_login_postgres`, which can't use `extensions`.
- Run `supabase config diff` before `config push`, with `supabase/.env.local`'s variables loaded; otherwise the Google client ID is pushed as the literal `env(...)`.
- Run `pnpm db:types` after every schema change and commit the result; never hand-edit or Prettier `src/lib/supabase/database.types.ts` (CI diffs it).
- Run `pnpm build` before `pnpm check:bundle`, which scans `.next`.
- Give a new `serverEnvSchema` key a canary value in `.github/workflows/ci.yml`'s env, since `check:bundle` fails on an unset key under `CI=true`. Keep `VERCEL_ENV` and other short public values out of the schema: `check:bundle` byte-matches every schema value of 8+ characters.
- Store a Vercel variable by pasting it at `vercel env add`'s prompt or piping `printf '%s'`, never `echo`: a trailing newline made `SUPABASE_SECRET_KEY` fail the Vercel build.
- Use the `vercel` CLI (`vercel api` for the rest), never the Vercel MCP, which gets 403 on this team.

## Conventions that differ from defaults

- Postgres decides: RLS governs every read, every state change is one `security definer` command (empty `search_path`, its target locked `FOR UPDATE`), and clients write no table directly. A Server Action only Zod-parses, calls one RPC, maps the error and revalidates.
- Offer only what `task_capabilities` returns; TypeScript never decides permissions or filters slots by state or column.
- "Active" is `private.is_member_active`; call it, never restate the predicate.
- Hosted Supabase grants `service_role` every new `public` table, which the local `auto_expose_new_tables = false` hides: revoke it on sensitive tables, and grant it explicitly when a story needs it.
- Only `ADMIN_CLIENT_IMPORTERS` in `eslint.config.mjs` may import `src/lib/supabase/admin.ts` (the secret key, which bypasses RLS); add an importer only when the spine's AD-6 names it.
- Call `requireActiveMember()` (member pages) or `requireAdmin()` (admin pages) first, before any `Suspense`: a layout doesn't stop its page rendering, and a redirect inside a streamed boundary becomes a client meta refresh.
- `/api` and `/auth` aren't proxied, so their handlers check the session themselves with `getClaims()`.
- Build absolute URLs only from `NEXT_PUBLIC_SITE_URL`, never `request.url` or the `Host` headers, and pass every accepted `next` through `safeReturnPath`.
- Render a stored URL only through `ExternalLink` (`src/components/ui/external-link.tsx`).
- Record only unexpected server faults, with `recordErrorEvent` inside `after()`: a mapper's fallback or a caught server fault, never a known code, a Zod or parse failure, or anything from browser code.
- Only `src/lib/time.ts` names a time zone; convert Philippine time with its helpers, never by adding or subtracting eight hours.
- The `members` barrel carries `server-only` code: client components import inside their slice by relative path, and client-safe modules take labels as data or from generated `Constants`.
- Treat Realtime as a refetch signal only; never read its payload.
- Never put `outline-none` next to `outline-2`: in Tailwind 4 it sets the outline style to none.

## Known pitfalls

- Stub env with `vi.stubEnv` in `beforeEach`, never `beforeAll`: `vitest.config.ts`'s `unstubEnvs` undoes stubs before each test.
- A test reaching the `members` barrel (most of `src/features/tasks/`, `admin-shell.tsx`) must mock `@/lib/supabase/server`, `@/lib/env.client` and `@/features/members/actions` (`() => ({})`); without them it fails locally and passes in CI, which sets the key canary.
- After another tool's or LLM's run, check `supabase migration list --local` and `--linked` for rows with no file behind them, confirm `supabase/.temp/project-ref`, and run `supabase test db`: one such run renamed an applied migration and deleted the staging link.

<!-- /bmad:context -->
