# The Pillar Portal

Internal management and applicant-intake portal for The Pillar, a university
student publication. Next.js 16 (App Router) with Tailwind 4 and shadcn/ui,
deployed on Vercel in `sin1`.

## Setup

Requires Node 24 and pnpm 12 (`corepack enable` picks up the version pinned in
`package.json`).

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The app runs at http://localhost:3000, and `GET /api/health` returns
`{"status":"ok","timestamp":"..."}`.

`NEXT_PUBLIC_SITE_URL` is required. `next dev`, `next build` and `next start`
stop with the variable named when it is missing or is not an http(s) URL.

## Checks

CI runs these in order on every pull request and on pushes to `main`, and a
failing step blocks the merge:

| Command | What it checks |
|---|---|
| `pnpm lint` | ESLint, including the architecture rules: only `src/lib/env.server.ts` and `src/lib/env.client.ts` use `process`; no import cycles; slices under `src/features/` are imported only through their `index.ts`; `members`, `files` and `email` import no other slice, and `tasks`, `reports` and `recruitment` may import only `members`, `files` and `email`; nothing outside `src/app` imports `src/app`; only `src/lib/utils.ts` imports the `cn` package (everything else uses `cn` from `@/lib/utils`) |
| `pnpm typecheck` | `next typegen`, then `tsc --noEmit` |
| `pnpm check:hex` | No hex color in any file under `src/` except `src/app/globals.css`, which holds the design tokens |
| `pnpm test` | Vitest: unit tests, plus tests that run the lint config and the two check scripts against temp-dir fixture projects |
| `pnpm build` | Production build |
| `pnpm check:bundle` | Browser-facing build output (`.next/static`, and prerendered `.html`, `.rsc` and `.body` files) contains no Supabase secret key and no server-only env value of 8+ characters; run after `pnpm build`. Unset server-only variables are listed as not scanned, and under `CI=true` they fail the check (every server-only variable needs a canary value in CI) |

To run the whole gate locally:

```bash
pnpm lint && pnpm typecheck && pnpm check:hex && pnpm test && pnpm build && pnpm check:bundle
```

## Layout

- `src/app/` routes, including `api/health`
- `src/lib/` shared code, including the two env modules
- `src/components/ui/` shadcn components
- `src/instrumentation.ts` validates the env modules when the server starts
- `scripts/` the `check:hex` and `check:bundle` scripts
