# Operations

The runbook for The Pillar Portal's production: who owns what, how production
goes live, how the first admin is made, how the portal changes hands, and how
to read the records it keeps about itself.

This file is public, like the rest of the repository. It holds no secret, no
personal data and nothing from the planning material. Every credential, and
the role account's address, live only in the role account's password manager.
Where a step needs a value, this file names the place to find it, never the
value.

## 1. Production accounts

Every production account is owned by **The Pillar's role account**, a Google
account with two-step verification that the Online Manager holds. The
developer joins each account as a member where the free tier allows, so the
portal never depends on one person's own account.

| Account | What it holds |
|---|---|
| Cloudflare | The domain (bought through Cloudflare Registrar), its DNS, and Turnstile for the public forms |
| Vercel | The production project (Hobby, functions in `sin1`) and its environment variables |
| Supabase organization | The production project (Singapore), and any scratch project made for a restore test |
| Resend | The sending domain and the API key |
| Google Cloud | The production OAuth client and its consent screen |
| GitHub | `pillar-portal` (public, the app code) and `pillar-portal-backups` (private, the backup workflow and its public key), under the role account or an organization it owns |
| Uptime monitor | A free check on `https://<app host>/api/health` every 5 minutes, alerting the role account's email |

No university-controlled domain, subdomain or account is used anywhere.

Until go live, only staging exists, in the developer's own Vercel and Supabase
accounts. It holds synthetic data only.

## 2. Go-live steps

Go live is Story 3.5. Its steps, in order. A step marked **owner** is done by
the Online Manager on the role account; the rest are done by the developer,
then checked.

1. **Owner:** create the role account (a Google account with two-step
   verification, its credentials in a password manager the Board controls).
   Every account below is registered to it.
2. **Owner:** buy the domain through Cloudflare Registrar and choose the app's
   hostname. Check: `dig NS <domain>` shows Cloudflare's nameservers.
3. **Owner:** transfer `pillar-portal` and `pillar-portal-backups` to the role
   account (or an organization it owns), keeping the developer as a
   collaborator. Check with `gh repo view` and `gh api`: the role account
   owns both; `pillar-portal` is public with its `main` branch rule and secret
   scanning with push protection; `pillar-portal-backups` is private.
4. **Owner:** give the developer's Supabase CLI access to the role account's
   organization (`supabase login`). Then create the production project in
   Singapore, link it and run `pnpm exec supabase db push`. Check: `supabase
   projects list` shows it on Postgres 17, every migration is applied, and the
   sections, desks and positions rows exist. Save its database password in
   the password manager.
5. **Owner, in the Supabase dashboard:** switch the JWT signing key to ES256,
   and **turn off Realtime's "Allow public access"**. Check: the project's
   `jwks.json` shows `alg` `ES256`, and a signed-out client subscribing to
   `task-changes` receives nothing.
6. **Owner:** create the production Google OAuth client (consent screen
   published, basic scopes only) with the redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. Then run
   `pnpm exec supabase config diff` and, with the owner's yes,
   `pnpm exec supabase config push`. Check through the Management API: Google
   is the only OAuth provider; the email provider (sign-up and sign-in),
   phone and anonymous sign-in are off; the Site URL is `https://<app host>`;
   the only redirect URL is `https://<app host>/auth/callback`; and
   `select count(*) from auth.identities where provider = 'email'` returns 0.
7. **Owner:** sign the Vercel CLI in as the role account and give the Vercel
   GitHub app access to `pillar-portal`. Then create the production Hobby
   project and set its variables with `vercel env add`:
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` (a
   dedicated secret key made for this project in the Supabase dashboard,
   added with `--sensitive`). The same project's **Preview** environment
   needs staging's values, or every preview fails to start:
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for staging, staging's own
   `SUPABASE_SECRET_KEY` (`--sensitive`), and the persona variables
   (`PROTOTYPE_PERSONAS`, `PROTOTYPE_PERSONA_PASSWORD`). Add the app hostname
   as the project's domain and its DNS record in Cloudflare (DNS only, not
   proxied). Check: `main`
   deploys to production in `sin1`; `https://<app host>/api/health` returns
   200; `vercel env ls production` shows no `PROTOTYPE_PERSONAS`; `EMAIL_MODE`
   stays `sink` until Story 4.4; previews use the staging project with
   personas on and `EMAIL_MODE=sink`.
   - **Open decision: how `main` reaches production.** Option 1 (preferred):
     stay trunk-based, keep migrations additive, push each migration to
     production before the merge that needs it, and use Vercel's Instant
     Rollback as the undo. Option 2: Vercel deploys a `production` branch
     that is fast-forwarded from `main` after the staging checks. Decide here
     and record the decision in this file.
8. **Owner:** create the Resend account, a Resend API key and a Cloudflare API
   token limited to this zone's DNS; keep both in the password manager and
   share them with the developer for this step only. Then add the sending
   domain in Resend, turn off open and click tracking, and publish SPF, DKIM
   and DMARC (`p=none` to start) through the Cloudflare API. Check: `dig`
   shows all three records and Resend reports the domain verified. Nothing is
   sent until Story 4.4.
9. **Owner:** create the uptime monitor's account and its check on
   `https://<app host>/api/health` every 5 minutes. Check: a test alert
   reaches the role account.
10. **Owner:** generate the production `age` key pair; keep the private key in
    the password manager plus a sealed offline copy. Then commit the public
    key to `pillar-portal-backups`, remove the test key, set the production
    session-pooler URL as its secret and run the workflow once. Check: an
    encrypted artifact exists, and production's `job_runs` shows a `backup`
    run with status `ok` (section 5).
11. **Owner:** decrypt that artifact. Then restore it into a scratch project
    in the role account's organization and compare row counts. Once they
    match, delete the scratch project and the decrypted file, and record the
    date of this restore test here (a launch gate).
12. **The first admin:** the current Editor-in-Chief signs in once on
    production with Google and sees Awaiting approval. Run the bootstrap
    (section 3). Check: their next page load lands on What's mine as the
    Editor-in-Chief, with the admin area available. They then approve the
    rest of the Board at `/admin/members`.
13. **The Messenger check:** the Editor-in-Chief creates the task "Launch
    check — Messenger link" with the developer in a slot and pastes its Copy
    for Messenger message into a chat. On a real iPhone and a real Android
    phone, open the link from Messenger, follow **Open in your browser**,
    sign in once with Google, then open the link from Messenger again: it
    must reach the task signed in. Then tap I'm on it, move it to For Review,
    and the Editor-in-Chief marks it Done.
14. **By November 30:** the Board decides whether to license the wordmark
    font or use the logo artwork. Until then the header sets the wordmark in
    Georgia; the font file is never committed.
15. **Security headers:** decide on `Strict-Transport-Security`,
    `Permissions-Policy`, `Cross-Origin-Opener-Policy` and CSP violation
    reporting, apply what is adopted in `src/lib/security-headers.ts`, and
    record the decision here.
16. **The launch gates, together:** production has no email identities and
    its email provider is off; the Messenger check passed on both phones;
    SPF, DKIM and DMARC are published and the domain is verified in Resend; a
    restore test passed; personas are off in production;
    `supabase migration list --linked` against production shows no
    local-only migration; and Story 1.10's manual checks passed on a real
    iPhone. Only then is the first real task entered.

## 3. The bootstrap

Approval never grants Editor-in-Chief, and only an admin can approve, so a
fresh production database has no way to make its first admin.
`private.bootstrap_admin(email)` is that way. It runs once.

**Precondition:** the member has signed in once on production with Google
(they see Awaiting approval), and nobody is an admin yet.

**What it does:** gives that member Editor-in-Chief as their primary
position. Their role follows the position: they become an active
`editorial_admin`. It records one `job_runs` row (`bootstrap`, `ok`) and
returns their member id.

**Who can run it:** only the database owner, as SQL. No API role (`anon`,
`authenticated`, `service_role`) holds EXECUTE on it, so the app can't call
it. Run it one of two ways, with the CLI linked to production:

```bash
pnpm exec supabase db query --linked "select private.bootstrap_admin('<email>')"
```

or in the Supabase dashboard's SQL Editor, which runs as `postgres`:

```sql
select private.bootstrap_admin('<email>');
```

The email is compared the way members are stored: case and surrounding spaces
don't matter. (On staging, on 2026-10-21, the CLI's login role ran an
owner-only `private` function with no grant, so both ways work.)

**When it refuses**, it raises one of these codes, with an English detail,
and writes nothing:

| Code | Meaning | What to do |
|---|---|---|
| `members.admin_exists` | Someone is already an admin (a deactivated admin counts), so the bootstrap is closed | An admin approves the member at `/admin/members` |
| `members.not_found` | No member has that email | Check the spelling; the person must sign in once with Google first |
| `members.not_pending` | That member is declined, deactivated or already active | Only a member waiting for approval can be bootstrapped |

## 4. Handover

When the Online Manager or the developer changes:

1. **Hand over the role account**, and with it the password manager.
2. **Remove the outgoing people** from every account in section 1 where they
   joined as members.
3. **Rotate every server secret**, each where it lives:
   - `SUPABASE_SECRET_KEY`: make a new secret key in the Supabase dashboard
     (API Keys). `vercel env add` refuses a name that already exists, so on
     the Vercel production project run
     `vercel env rm SUPABASE_SECRET_KEY production`, then
     `vercel env add SUPABASE_SECRET_KEY production --sensitive`. Redeploy,
     check `/api/health` returns 200, then delete the old key in the
     dashboard.
   - Later server secrets (`CRON_SECRET` from Epic 4, the Resend API key):
     on the Vercel production project, the same way.
   - The Cloudflare API token: revoke it, and make a new one only when a step
     needs it.
   - **The database password:** reset it in the Supabase dashboard, then
     update `pillar-portal-backups`' session-pooler URL secret with
     `gh secret set`.
   - **The OAuth secrets:** make a new client secret for the production
     Google OAuth client in Google Cloud, push it with
     `pnpm exec supabase config push` (the CLI reads it from
     `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the git-ignored
     `supabase/.env.local`), then delete the old secret.
   - **The backup key:** generate a new `age` key pair, commit the new public
     key to `pillar-portal-backups`, and keep the old private key until the
     last backup encrypted to it has expired (90 days).
4. **Test a restore** with the new backup key. Story 2.5 adds the restore
   steps to this file.

Staging (its Supabase and Vercel projects, its secret key and its persona
password) lives in the developer's own accounts, so a developer handover
moves it or recreates it.

## 5. Reading `job_runs` and `error_events`

Vercel Hobby keeps logs for one hour, so the portal keeps its own records:

- **`job_runs`:** one row per run of a job (`backup`, `bootstrap`, and Epic
  4's `daily` with its steps). A run is open while `finished_at` is empty.
  `status` is `ok`, `failed` or `skipped`. `skipped` means the run started
  while another run of the same job was still going. A run whose process
  died stays open, and shows under "Runs still open" below, until the next
  time the same job starts: if it is over an hour old by then, that start
  closes it `failed` with `{"reason":"abandoned"}`. Nothing closes it before
  that. `detail` is a small note, such as an artifact's size, never data.
- **`error_events`:** one row per unexpected server error.
  - `code`: a Postgres SQLSTATE (`42501` is permission denied), a
    PostgREST `PGRST...` code or an Auth code (the error's own, or that of
    the database error it wraps), or else an error's class name.
  - `route`: where it happened, never with a query string.
    - An error Next.js captures (a thrown page, Route Handler, Server Action
      or proxy) is `<routeType> <routePath>`: `render`, `route`, `action` or
      `proxy`, then the route's file pattern, so a thrown Server Action on
      the members page reads `action /(admin)/admin/members`.
    - An unexpected error an action maps to its generic message is
      `action <actionName>`, such as `action moveTaskAction`.
    - The sites that catch a fault themselves name themselves:
      `render admin-banners #<n>` (the n-th banner source),
      `route /api/tasks/[id]/ics`, `route /auth/callback` and
      `action signInWithGoogleAction`.
  - `entity_type` and `entity_id`: the row an action was about.
  - `digest`: the id Next.js shows on its error page (`<hash>@E<n>` for
    Next's own errors).

Neither table holds names, emails, messages, tokens or request bodies.
`entity_id` is only a row id, but for `member` rows it is a member's id,
which an admin can join back to a person; a later erasure story should cover
it. Admins can read both; nobody writes them except the server's commands.
Run these in the dashboard's SQL Editor, or with
`pnpm exec supabase db query --linked "<query>"`.

The latest run of each job:

```sql
select distinct on (job) job, step, status, started_at, finished_at, detail
from public.job_runs
order by job, started_at desc;
```

Runs still open:

```sql
select id, job, step, started_at
from public.job_runs
where finished_at is null
order by started_at;
```

Errors by code and route over the last 7 days:

```sql
select code, route, count(*) as errors, max(occurred_at) as last_seen
from public.error_events
where occurred_at > now() - interval '7 days'
group by code, route
order by errors desc, last_seen desc;
```

The error behind an error page (production shows its digest on the page):

```sql
select occurred_at, code, route, entity_type, entity_id
from public.error_events
where digest = '<digest>';
```

`error_events` rows are kept 30 days; from Epic 4, the daily job deletes older
ones.
