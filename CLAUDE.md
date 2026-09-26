# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Next.js 16 agent rules (read them before writing Next code): @AGENTS.md

## Repository state

This is a public repository that holds **application code only**. The app was scaffolded in Story 1.1 with the shadcn CLI (`init -t next -b radix`) and follows the architecture spine.

**Code:**
- `src/app/` — App Router routes. So far: a placeholder home and `GET /api/health` (returns `{"status":"ok","timestamp":"<ISO-8601 UTC>"}`, reads and writes nothing).
- `src/lib/env.server.ts` (`server-only`) and `src/lib/env.client.ts` — the only readers of `process.env`, validated with Zod. `next.config.ts` imports `env.client`, so a missing or malformed `NEXT_PUBLIC_SITE_URL` stops `next dev`, `next build` and `next start` with the variable named. `src/instrumentation.ts` `register()` imports both at server start, which is where server-only variables are checked.
- `src/app/globals.css` — the DESIGN.md tokens in Tailwind's `@theme`, mapped onto shadcn's variables. It is the only file under `src/` allowed to contain a hex color. There is no dark mode.
- `src/components/ui/` — shadcn components. `src/features/<slice>/` arrives with later stories.
- `src/lib/utils.ts` — `cn`, extended with the DESIGN.md text, shadow and spacing tokens so merges don't drop them. Import `cn` from here only; lint bans importing the `cn` package anywhere else.
- `scripts/check-no-hex.mjs`, `scripts/check-bundle-secrets.mjs` — the two custom CI checks.
- `vercel.json` pins functions to `sin1`; `.github/workflows/ci.yml` is the merge gate.

**Commands** (Node 24, pnpm 12.6 from `packageManager`; pnpm settings live only in `pnpm-workspace.yaml`):
- Setup: `pnpm install`, `cp .env.example .env.local`, `pnpm dev`.
- `pnpm lint` — ESLint with the architecture rules: `process` (and so `process.env`) only in the two env modules; `import/no-cycle`; AD-2 slice boundaries (imports through `index.ts` only; `members`, `files` and `email` import no slice; `tasks`, `reports` and `recruitment` may import only `members`, `files` and `email`; nothing outside `src/app` imports `src/app`; a folder under `src/features/` that isn't one of the six slices fails the config load); `cn` only from `@/lib/utils`.
- `pnpm typecheck` — `next typegen && tsc --noEmit` (needs `NEXT_PUBLIC_SITE_URL`, since typegen loads `next.config.ts`).
- `pnpm check:hex` — fails on a hex color anywhere under `src/` except `globals.css`.
- `pnpm test` — Vitest (`vitest run`) over root `*.test.ts` (`eslint.config.test.ts` runs the real lint config over fixtures; `next.config.test.ts` pins the env wiring), `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.ts`. Env tests stub with `vi.stubEnv` + `vi.resetModules` and import dynamically. The check-script tests run the real scripts with `--root <temp-dir fixture>`, never against the real `src/` or `.next/`.
- `pnpm build`, then `pnpm check:bundle` — fails if `.next/static` or the prerendered `.html`/`.rsc`/`.body` files under `.next/server/app` contain `sb_secret_` or the value (8+ characters) of any `serverEnvSchema` key. Unset keys are listed as not scanned; under `CI=true` an unset key fails the check, so each new server-only variable needs a canary value in CI.
- CI runs install (`--frozen-lockfile`), lint, typecheck, check:hex, test, build, check:bundle, in that order, as the required `ci` check on `main`.

**Local-only material (git-ignored, never committed):** `_bmad/`, `_bmad-output/`, `.claude/` and `docs/` hold the BMad framework and the planning artifacts. Where you have them locally:
- `_bmad-output/planning-artifacts/prds/prd-pillar-portal-2026-08-30/prd.md` — the PRD, the source of truth for product intent.
- `_bmad-output/planning-artifacts/ux-designs/ux-pillar-portal-2026-09-12/` — `EXPERIENCE.md` (behavior, flows, states, copy) and `DESIGN.md` (visual tokens).
- `_bmad-output/planning-artifacts/architecture/architecture-pillar-portal-2026-09-25/ARCHITECTURE-SPINE.md` — invariants AD-1…AD-22, the Entity Ownership Catalog, the pinned stack and the source tree.
- `_bmad-output/planning-artifacts/epics.md` and `_bmad-output/implementation-artifacts/` — the 48 stories, per-story specs and `sprint-status.yaml`.

**Precedence:** EXPERIENCE.md wins over the PRD for behavior and copy; the architecture spine wins over both for data, commands, security, and sequencing. `docs/private/` is sensitive: never commit it or quote from it in committed files. `.env*` (except `.env.example`), `.vercel` and any Elgraine font file are also ignored.

## Working via the BMad Method

This project is driven through **BMad Method** (v6.11.0), a phase-based workflow of Claude Code skills (installed under `.claude/skills/bmad-*`, one skill per `SKILL.md`). Invoke phases by name (e.g. "run bmad-architecture", "/bmad-build") rather than improvising equivalent ad hoc steps — the skills encode the project's checklists, templates, and file-placement conventions.

**Phase flow**: `2-planning` (bmad-product-brief / bmad-prfaq → bmad-prd → bmad-ux) → `plan` (bmad-architecture → bmad-create-epics-and-stories → bmad-sprint-planning) → `ship` (bmad-build → bmad-code-review → bmad-checkpoint-preview → bmad-qa-generate-e2e-tests → bmad-retrospective). `bmad-help` will recommend the next appropriate skill given current state; `bmad-correct-course` handles significant scope/direction changes mid-stream.

Story 1.1 (scaffold, tokens, health route, CI) is built. Check `_bmad-output/implementation-artifacts/sprint-status.yaml` for the next story — unless the user says otherwise.

**Output locations** (from `_bmad/bmm/config.yaml`):
- Planning artifacts (PRD, architecture, epics/stories) → `_bmad-output/planning-artifacts/`
- Implementation artifacts (sprint status, build logs) → `_bmad-output/implementation-artifacts/`
- Project knowledge / reference docs → `docs/`

**Configuration layering** — three tiers, later wins:
1. `_bmad/config.toml` / `_bmad/bmm/config.yaml` / `_bmad/core/config.yaml` — installer-managed, regenerated on every install. Treat as read-only; don't hand-edit.
2. `_bmad/custom/config.toml` — team overrides (local only, since `_bmad/` is git-ignored), deep-merges over base config (e.g. to override an agent's persona/description or add a custom agent).
3. `_bmad/custom/config.user.toml` — personal overrides, gitignored, wins over both.

Durable config changes belong in `_bmad/custom/`, not in the installer-managed files. Use the `bmad-customize` skill to author overrides rather than hand-writing TOML.

**Agent personas** (used by the `bmad-agent-*` skills, e.g. when the user asks to "talk to Mary"): Mary (Analyst), John (PM), Sally (UX Designer), Winston (Architect), Amelia (Dev). Each has a distinct voice defined in `_bmad/config.toml`.

## Product context (from the PRD)

**The Pillar Internal Portal** is an internal management + applicant-intake tool for a university student publication, running on free tiers plus one Pillar-owned domain. Three milestones: a **mid-October 2026 prototype** (Stories 2.0–2.7: task Board, Planner, What's mine, task detail/response loop, Copy for Messenger, on seeded persona users in a staging project); a **soft launch** right after a successful demo (Stories 1.3–1.5 and 1.8: real OAuth, member approval, and production under a Pillar role account, before any real task is entered); and a **hard launch by November 30, 2026**.

Core problem: staff coordinate over unstructured chat, end-of-semester accomplishment reports are collected manually and printed by hand, and recruitment email from personal Gmail accounts gets spam-filtered.

**Org structure:** `docs/pillar-org-structure.md` records The Pillar's real positions (Staff roles, Section Editors, desk Heads, the rest of the Editorial Board, Technical Advisers), its group chats, and how article and supplementary work is assigned. Read it before touching sections, desks, positions, approvers, personas, or member roles. Its implications were settled in PRD v1.8 (`sprint-change-proposal-2026-09-25-org-structure.md`).

### Architecture (from the spine; being implemented story by story)
- **Paradigm**: vertical feature slices (`members`, `tasks`, `reports`, `recruitment`, `email`, `files`) over a database-authoritative core. **Postgres is the rulebook**: RLS governs every read, every state change is exactly one Postgres command function, and clients have no direct write access to any table or storage object. Server Actions are thin (Zod-parse → call one command → map error → revalidate); Route Handlers are a fixed allowlist.
- **Stack**: Next.js 16 App Router (`src/proxy.ts`, not middleware) on Vercel Hobby pinned to `sin1`; Supabase Free in Singapore (Postgres 17, Auth with Google, Discord, and TOTP MFA, private Storage, Realtime as a refetch signal only); Resend from a Pillar-owned domain; Cloudflare Turnstile on `/apply` and `/status`; GitHub Actions for CI and a weekly encrypted backup. pnpm. Exact versions are in the spine's Stack table.
- **Cost constraint**: $0/month on free tiers, plus a ≈$11/year domain funded by The Pillar. Storage is enforced under 400 MB (upload reservations); email is capped at 100/day and 3,000/month.
- **RBAC**: roles `staff`, `editorial_admin`, `pending` (following each member's positions: one or more of The Pillar's 22 titles, one primary), plus declined and deactivated states. A task is owned by a content section (articles) or a desk (supplementary and desk work). Only a task's **approver** (the head of its content section or desk, or a top editor: Editor-in-Chief, Associate Editor, Managing Editor) can mark it Done, send it back, reopen, edit, delete, or reassign slots. High-impact admin actions require a TOTP step-up within 15 minutes.
- **Email**: every email is a row in one `email_outbox`, sent by one sender, drained in a fixed order (reminders → advances needing action → confirmations/status codes → report notices → not-selected). Non-production never delivers.
- **Cron**: one daily job, `/api/cron/daily` (00:00 UTC = 08:00–08:59 PHT): reminders, outbox drain, archive purges, cycle erasures, staging sweep, retention.
- **Files**: the browser uploads straight to a private staging path through a signed URL; the server validates contents (DOCX structure without macros or external links, PDF header and trailer, JPEG/PNG) before promoting the file. ZIP export streams with archiver, capped at 100 files and 150 MB.
- **Testing**: pgTAP for rules (four-caller allow/deny matrix, catalog, erasure) and Vitest for units; Playwright after the prototype. CI blocks merge.
- **UI**: Tailwind 4 + shadcn (Radix) with DESIGN.md tokens; mobile-first for member and public routes, desktop-first for admin routes; WCAG 2.2 AA.

Read the PRD, EXPERIENCE.md, and the architecture spine before implementation work rather than relying on this summary.
