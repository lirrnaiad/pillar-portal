# Operations

The runbook for The Pillar Portal's production: who owns what, how production
goes live, how the first admin is made (and a mistaken decline undone), how
the portal changes hands, how to read the records it keeps about itself, and
how its backups run and restore.

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
| Supabase organization | The production project (Singapore), and a replacement project during a real restore |
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
   Singapore. Its database password must be letters and digits only, since
   the backup workflow refuses other characters (section 6): reset it in the
   dashboard if it isn't. Save it in the password manager.

   Then set up **`<prod>`, production's CLI workdir**. `<app>` is the
   developer's checkout of `pillar-portal`, which stays linked to staging:
   `cat <app>/supabase/.temp/project-ref` must print `sxlgelitcaolpiijfwsq`.
   If it doesn't, stop and fix `<app>`'s link before anything else. `<prod>`
   is a new, empty directory outside every repository. Write both as
   absolute paths. `<prod>`'s `supabase/config.toml` and `supabase/migrations`
   are symlinks to `<app>`'s, and it has no `seed.sql`, so nothing ever seeds
   production. Run each `pnpm exec supabase` from `<app>`, on an up-to-date
   `main`:

   ```bash
   mkdir -p <prod>/supabase
   ln -s <app>/supabase/config.toml <app>/supabase/migrations <prod>/supabase/
   pnpm exec supabase link --project-ref <project-ref> --workdir <prod>
   git -C <app> status
   cat <prod>/supabase/.temp/project-ref
   pnpm exec supabase db push --workdir <prod> --dry-run
   pnpm exec supabase db push --workdir <prod>
   ```

   If `link` asks for the database password, leave it blank. After `link`,
   `git -C <app> status` shows nothing new. Before any production push,
   `cat <prod>/supabase/.temp/project-ref` prints production's ref. Each
   production push needs the owner's yes.

   From here on, every CLI command against production passes
   `--workdir <prod>`, as in sections 3 and 5; without it, `--linked` reaches
   staging. Never relink `<app>`. The symlinks follow `<app>`'s checked-out
   branch, so `db push`, `config diff` and `config push` through `<prod>` use
   that branch's migrations and config. Run `config diff` and `config push`
   against production only from an up-to-date `main`. Run `db push` from any
   other branch only under step 7's rules.

   Check: `pnpm exec supabase projects list` shows the project on Postgres
   17; `pnpm exec supabase migration list --workdir <prod> --linked` shows
   every migration applied; the sections, desks and positions rows exist
   (`pnpm exec supabase db query --workdir <prod> --linked "select count(*) from public.positions"`,
   and the same for `sections` and `desks`); and after this and every later
   production step, `cat <app>/supabase/.temp/project-ref` still prints
   `sxlgelitcaolpiijfwsq`.
5. **Owner, in the Supabase dashboard:** switch the JWT signing key to ES256,
   and **turn off Realtime's "Allow public access"**. Check: the project's
   `jwks.json` shows `alg` `ES256`, and a signed-out client subscribing to
   `task-changes` receives nothing.
6. **Owner:** create the production Google OAuth client (consent screen
   published, basic scopes only) with the redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. Save its ID and
   secret in the password manager as these two lines, which the developer
   pastes later:

   ```bash
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<the production client's ID>
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<its secret>
   ```

   Then, as the developer:
   - Give `supabase/config.toml` production's block in a pull request, and
     merge it before `config diff` and `config push`. If the file has no
     `[remotes.production]`, add it at the end, after `[remotes.staging]`;
     if it has one, edit only its `project_id`. Never write a second block.
     Production has no personas, so its email provider is off:

     ```toml
     [remotes.production]
     project_id = "<project-ref>"

     [remotes.production.auth]
     site_url = "https://<app host>"
     additional_redirect_urls = ["https://<app host>/auth/callback"]

     [remotes.production.auth.email]
     enable_signup = false
     ```

   - From `<app>`, on an up-to-date `main`, open a clean shell, clear both
     Google variables and write `<prod>/supabase/.env.local`. At the `cat`,
     paste the two lines from the password manager, press Enter after the
     last one, then Ctrl-D:

     ```bash
     bash --noprofile --norc
     unset SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET
     (umask 077; cat > <prod>/supabase/.env.local)
     chmod 600 <prod>/supabase/.env.local
     grep -c '^SUPABASE_AUTH_EXTERNAL_GOOGLE_' <prod>/supabase/.env.local
     ```

     The `grep` must print 2.
   - Load the two variables in that shell, check both are set, then run
     `config diff`:

     ```bash
     set -a; . <prod>/supabase/.env.local; set +a
     test -n "${SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID}" && test -n "${SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET}" && echo "both set"
     pnpm exec supabase config diff --workdir <prod>
     ```

     It must show the production client's ID (never the literal
     `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`, which `config push`
     would push as the value), the production Site URL and redirect URL, and
     email sign-up off. If it shows a localhost or staging Site URL, or
     email sign-up on, stop. Otherwise, with the owner's yes, run
     `pnpm exec supabase config push --workdir <prod>` in that shell.

   Check, in the same shell: `pnpm exec supabase config diff --workdir <prod>`
   shows no difference, so production has the committed settings (Google the
   only OAuth provider; the email provider, phone and anonymous sign-in off;
   the Site URL `https://<app host>`; the only redirect URL
   `https://<app host>/auth/callback`); and
   `pnpm exec supabase db query --workdir <prod> --linked "select count(*) from auth.identities where provider = 'email'"`
   returns 0. Then `exit`, and close the terminal or clear its scrollback.
7. **Owner:** sign the Vercel CLI in as the role account and give the Vercel
   GitHub app access to `pillar-portal`. Then create the production Hobby
   project and set its variables with `vercel env add`:
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` (a
   dedicated secret key made for this project in the Supabase dashboard,
   added with `--sensitive`). The same project's **Preview** environment
   needs staging's values, or every preview build fails:
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for staging, staging's own
   `SUPABASE_SECRET_KEY` (`--sensitive`), and the persona variables
   (`PROTOTYPE_PERSONAS`, `PROTOTYPE_PERSONA_PASSWORD`). Add the app hostname
   as the project's domain and its DNS record in Cloudflare (DNS only, not
   proxied). A missing or malformed server variable fails the Vercel build
   and leaves the live deployment as it was; for the key the build log says
   `SUPABASE_SECRET_KEY: must be a secret key (sb_secret_…)`. Check: `main`
   deploys to production in `sin1`; `https://<app host>/api/health` returns
   200; `vercel env ls production` shows no `PROTOTYPE_PERSONAS`; `EMAIL_MODE`
   stays `sink` until Story 4.4; previews use the staging project with
   personas on and `EMAIL_MODE=sink`; and "Automatically expose System
   Environment Variables" is on for the production project
   (`vercel api /v9/projects/<project>` shows `"autoExposeSystemEnvs": true`),
   because the backup banner reads `VERCEL_ENV` and never shows without it.
   Then, while nothing is live, rehearse the first step of a real restore
   (section 6) once: `vercel project pause <project>`, check
   `https://<app host>/api/health` answers 503, then
   `vercel project resume <project>` and check it answers 200 again. If the
   CLI lacks those commands, use
   `vercel api /v1/projects/<project>/pause -X POST` and
   `vercel api /v1/projects/<project>/unpause -X POST` instead. Record which
   form worked here, since a real restore pauses and resumes in that form:
   not yet rehearsed.
   - **How `main` reaches production** (decided 2026-11-02). Production
     deploys `main` on every merge, with no separate production branch, and
     Vercel's Instant Rollback is the undo.
     - **Staging no longer gates production,** since both deploy on the
       merge. A story's pre-production and manual checks run on its pull
       request's Vercel preview (staging's database, personas) before the
       merge.
     - **Migrations stay additive:** new tables, nullable or defaulted
       columns, new functions or overloads. Anything else goes expand,
       deploy, then contract in a later pull request: a drop, a rename, a
       changed RPC signature, return type or meaning that the live code
       calls, a new NOT NULL column without a default, tighter RLS or
       constraints.
     - **A pull request's migrations go out before its merge.** Push them
       only once the pull request is approved, `ci` is green and it is
       rebased on current `main`, then merge straight after. From its branch
       in `<app>`:

       ```bash
       cat <app>/supabase/.temp/project-ref
       pnpm exec supabase db push --linked --dry-run
       pnpm exec supabase db push --linked
       pnpm exec supabase test db --linked
       pnpm exec supabase migration list --linked
       cat <prod>/supabase/.temp/project-ref
       pnpm exec supabase db push --workdir <prod> --dry-run
       pnpm exec supabase db push --workdir <prod>
       pnpm exec supabase migration list --workdir <prod> --linked
       ```

       The first `cat` prints `sxlgelitcaolpiijfwsq` (staging), the second
       production's ref. Each dry run must list only that pull request's
       migrations. Never use `--include-all`. Each production push needs the
       owner's yes, as `config push` does. After both pushes, each
       `migration list` shows no local-only and no remote-only row.
     - **If the pull request is then abandoned or must change,** never edit
       the applied migration. Keep its file and land it on `main` with a new
       migration that reverts or amends it, so `main` always holds every
       version production has: a restore copies migrations from `main`
       (section 6).
     - **Instant Rollback** (`vercel rollback`, or the dashboard) rolls back
       code only, never a migration, which is why migrations stay additive.
       On Hobby it goes back only to the previous production deployment; if
       that one is bad too, revert the pull request on `main` and let it
       deploy. After a rollback, Vercel stops assigning production to new
       deployments: once the fix merges, run `vercel promote <deployment>`
       (or undo the rollback) so production follows `main` again.
8. **Owner:** create the Resend account, a Resend API key and a Cloudflare API
   token limited to this zone's DNS; keep both in the password manager and
   share them with the developer for this step only. Then add the sending
   domain in Resend, turn off open and click tracking, and publish SPF, DKIM
   and DMARC (`p=none` to start) through the Cloudflare API. Check: `dig`
   shows all three records and Resend reports the domain verified. Nothing is
   sent until Story 4.4.
9. **The first admin:** the current Editor-in-Chief signs in once on
   production with Google and sees Awaiting approval. Run the bootstrap
   (section 3). Check: their next page load lands on What's mine as the
   Editor-in-Chief, with the admin area available, and their first Admin
   home (`/admin`) shows "No backup has run yet.". The backup banner shows
   only on production (`isProduction`: `VERCEL_ENV` is `production`, and the
   Supabase project is neither local nor staging), so seeing it proves step
   7's `VERCEL_ENV` reaches the app. They then approve the rest of the Board
   at `/admin/members`.
10. **Owner:** generate the production `age` key pair (`age-keygen`); keep the
    private key in the password manager, labelled with today's date and its
    public key, plus a sealed offline copy. Then,
    from the role account, in `pillar-portal-backups` (section 6):
    - Replace the whole of `age-recipients.txt`, its comment included, with
      the new public key and a comment saying it is production's; that
      removes Story 2.5's test key. In the same commit, re-save the `cron`
      line of `.github/workflows/backup.yml` by writing the same schedule as
      `17 18 * * SUN` instead of `17 18 * * 0`: GitHub emails a scheduled
      run's failure to whoever last changed that line, and that must be the
      role account.
    - Check that the role account's GitHub notification settings
      (Settings › Notifications, under Actions) email it about failed
      workflow runs.
    - `gh secret set SUPABASE_DB_URL -R <owner>/pillar-portal-backups`, and
      paste production's session-pooler URL (Connect › Session pooler: a
      host ending in `.pooler.supabase.com`, port 5432, with the database
      password filled in) at the prompt, never on the command line.
    - `gh workflow enable backup.yml -R <owner>/pillar-portal-backups`, then
      `gh workflow run backup.yml -R <owner>/pillar-portal-backups`.

    Check: the run is green; its artifact `backup-<n>` holds
    `backup.sql.gz.age`, `counts.tsv`, `migrations.txt` and `recipient.txt`
    (the new public key)
    (`gh run download <run id> -R <owner>/pillar-portal-backups -n backup-<n> -D <dir>`,
    then `ls <dir>` and `rm -r <dir>`); production's `job_runs` shows a
    `backup` run with status `ok` and the detail `{"bytes": <size>}`
    (section 5); and on the Editor-in-Chief's next Admin home load, "No
    backup has run yet." is gone. Then the developer deletes Story 2.5's
    test key file, `~/.config/pillar-portal-backups/test-key.txt`.
11. **The restore test (a launch gate). It waits for step 12**, so that
    production holds members, positions, a task with slots and sign-in
    sessions, and the test compares real counts rather than zeros. After
    step 12, run the workflow once more
    (`gh workflow run backup.yml -R <owner>/pillar-portal-backups`). Go
    live's test is hosted: it restores that run's artifact into a scratch
    project, with section 6's real-restore steps 2–5, run from a `<new>`
    workdir. Production is never touched, paused or repointed.
    - The restore test's preparations apply (section 6: `<app>`,
      `<backups>`, absolute paths, one `bash` session, and the restore
      test's step 1, the key). Start at the real restore's step 2. The real
      restore's step 1 doesn't run, so production stays open and the
      workflow stays enabled.
    - In the real restore's step 3, the new project is the scratch project,
      made in the role account's organization in Singapore. `<new>`'s
      migrations are copies of exactly the versions in `migrations.txt`,
      taken from `main` as that step says, never from `<app>`'s checked-out
      branch. Don't write `<new>/supabase/.env.local`, and skip the
      `[remotes.production]` edit and the paragraph on go-live steps 4–6:
      there is no config push.
    - The real restore's steps 4 and 5 load the backup and compare the
      counts. They must match. Its steps 6 to 11 don't run.
    - Once loaded, the scratch project holds a full decrypted copy of
      production, auth rows included, under default auth settings. Delete
      it in the same session, right after the comparison: with the owner's
      yes, in its dashboard's settings or with
      `pnpm exec supabase projects delete <scratch project ref>`. Check with
      `pnpm exec supabase projects list` that it's gone. Then delete the key
      files and the `<backup>` and `<new>` directories, `pgpass` included.
      The load decrypts only in its pipe, so once the scratch project is
      gone, no decrypted copy remains. Check that
      `<app>/supabase/.temp/project-ref` still prints `sxlgelitcaolpiijfwsq`,
      and `exit` the bash session.
    - If the load fails or a count doesn't match, the test failed. Record it
      as failed in section 6's log; step 16 is blocked. The clean-up above
      still runs. Find the cause (usually the wrong set of migrations), then
      run the test again on a fresh backup.

    Record each run in section 6's restore test log.
12. **The Messenger and Facebook check:** the Editor-in-Chief creates the task
    "Launch check — Messenger link" with the developer in a slot and pastes
    its Copy for Messenger message into a chat. On a real iPhone and a real
    Android phone, open the link from Messenger, follow **Open in your
    browser**, sign in once with Google, then open the link from Messenger
    again: it must reach the task signed in, through **Open in your
    browser** if Messenger opened the link in its own browser. Then, from
    one Facebook account signed in on both phones, put the same link in a
    post with the audience Only me, and open it from the post in the
    Facebook app on each phone: the same rule applies. Delete the post
    afterwards. Then the developer, on either phone, taps I'm on it and
    moves the task to For Review, and the Editor-in-Chief marks it Done.
13. **Owner:** create the uptime monitor's account and its check on
    `https://<app host>/api/health` every 5 minutes. Check: a test alert
    reaches the role account.
14. **By November 30:** the Board decides whether to license the wordmark
    font or use the logo artwork. Until then the header sets the wordmark in
    Georgia; the font file is never committed.
15. **Security headers** (decided 2026-11-02). `src/lib/security-headers.ts`
    sends these, beside the CSP, `nosniff` and `Referrer-Policy`:
    - `Strict-Transport-Security: max-age=63072000` (two years), only to an
      https site outside `next dev`. It has no `includeSubDomains`, so it
      holds only the app's hostname to https and no other name on the
      domain, and so no `preload` either, which requires it.
    - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`:
      the portal uses none of them.
    - `Cross-Origin-Opener-Policy: same-origin`: sign-in is a redirect,
      never a popup.
    - No CSP violation reporting: `error_events` holds unexpected server
      faults only, never anything a browser sends.

    Check: `curl -sI https://<app host>/login` and
    `curl -sI https://<app host>/api/health` each show
    `content-security-policy`, `x-content-type-options`, `referrer-policy`,
    `permissions-policy`, `cross-origin-opener-policy`, and
    `strict-transport-security` on exactly one line, with the value
    `max-age=63072000`.
16. **The launch gates, together:** production has no email identities and
    its email provider is off; the Messenger and Facebook checks passed on
    both phones; SPF, DKIM and DMARC are published and the domain is
    verified in Resend; the hosted restore test matched and its date is in
    section 6's log; personas are off in production;
    `pnpm exec supabase migration list --workdir <prod> --linked`, run from
    an up-to-date `main`, shows no local-only and no remote-only version;
    and Story 1.10's manual checks passed on a real iPhone. Only then is the
    first real task entered.

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
it. Run it one of two ways: from `<app>`, through production's CLI workdir
(go-live step 4):

```bash
pnpm exec supabase db query --workdir <prod> --linked "select private.bootstrap_admin('<email>')"
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

### Undoing a mistaken decline

The app has no undo for **Decline**. When an admin declines someone by
mistake, the database owner clears the decline with the statement below, so
the person is waiting for approval again. Use it only for a decline that was
a mistake: it changes nothing for a member who is active, deactivated or
already waiting.

Put the person's email in place of `<email>`. As with the bootstrap, case and
surrounding spaces don't matter. An apostrophe in the email is doubled:
`o''brien@…`. It is one statement, so `supabase db query` takes it. Run it in
production's dashboard SQL Editor, which runs as `postgres`, or save it to a
file and run
`pnpm exec supabase db query --workdir <prod> --linked -f <file>` from
`<app>` (go-live step 4). Never relink the checkout to production for it:
the checkout stays linked to staging, so `--linked` without
`--workdir <prod>` would run it there.
`supabase/tests/members/undo_decline.test.sql` runs this exact statement, so
change the two together; `src/features/members/undo-decline-runbook.test.ts`
fails when they differ.

```sql
with undeclined as (
  update public.members m
  set declined_at = null,
      updated_at = now(),
      updated_by = null
  where m.email = lower(regexp_replace('<email>', '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    and m.role = 'pending'
    and m.declined_at is not null
    and m.deactivated_at is null
  returning m.id, m.email
)
select id, email, private.log_activity(gen_random_uuid(), 'member', id, null, 'undeclined')
from undeclined
```

**What it does:** it clears the member's `declined_at`, sets `updated_at` to
now and leaves `updated_by` empty (no member made the change), and records
one `activity` row (`member`, `undeclined`, with no actor). It returns one
row: the member's id and email, and an empty third column (the activity
write).

**Zero rows** means nothing changed: no member has that email, or that member
isn't declined (still waiting, or active), or they are deactivated. Check the
spelling. A second run is safe: it returns zero rows.

**Afterwards:** the person's next sign-in shows Awaiting approval, and an
admin approves them at `/admin/members` as usual.

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
     `vercel env add SUPABASE_SECRET_KEY production --sensitive`, pasting
     the revealed key at the prompt (`echo` would add a newline, and the
     dashboard's masked text isn't the key; either fails the build). Redeploy,
     check `/api/health` returns 200, then delete the old key in the
     dashboard.
   - Later server secrets (`CRON_SECRET` from Epic 4, the Resend API key):
     on the Vercel production project, the same way.
   - The Cloudflare API token: revoke it, and make a new one only when a step
     needs it.
   - **The database password:** reset it in the Supabase dashboard, to
     letters and digits only (the backup workflow refuses other
     characters), then update `pillar-portal-backups`' session-pooler URL
     secret with `gh secret set`.
   - **The OAuth secrets:** make a new client secret for the production
     Google OAuth client in Google Cloud, and save the two lines in the
     password manager. Rewrite both lines of `<prod>/supabase/.env.local`
     the go-live step 6 way (a clean shell and `cat`, never an editor), then
     run `config diff` and `config push` with `--workdir <prod>` as that
     step does. Then delete the old secret.
   - **The backup key:** generate a new `age` key pair, commit the new public
     key to `pillar-portal-backups` as `age-recipients.txt`, and keep the old
     private key until the last backup encrypted to it has expired (90 days).
     Label both in the password manager with their dates and public keys:
     each artifact's `recipient.txt` names the key it was encrypted to, and
     during the overlap a restore passes both keys (section 6).
   - **The backup workflow's failure emails:** GitHub emails a scheduled
     run's failure to whoever last changed the `cron` line of
     `.github/workflows/backup.yml`. The new holder re-saves it, writing the
     same schedule the other way (`17 18 * * SUN` becomes `17 18 * * 0`, or
     back), and checks that their GitHub notification settings
     (Settings › Notifications, under Actions) email them about failed
     workflow runs.
4. **Test a restore** with the new backup key: run the workflow once
   (`gh workflow run backup.yml -R <owner>/pillar-portal-backups`), then run
   section 6's restore test on that run's artifact, the first backup
   encrypted to the new key. Record it in section 6's restore test log.

Staging (its Supabase and Vercel projects, its secret key and its persona
password) lives in the developer's own accounts, so a developer handover
moves it or recreates it. Production's CLI workdir, `<prod>`, lives on the
developer's machine. A new developer sets up only its workdir parts: go-live
step 4's `mkdir`, symlinks and `link`, and `.env.local` written the step 6
way. The outgoing developer deletes `<prod>/supabase/.env.local`, which
holds the Google secret.

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
  Section 6 says what each `backup` row means. Any retention rule added to
  `job_runs` later must keep the newest `ok` `backup` row: the admin
  banner reads it, and deleting it shows "No backup has run yet.".
- **`error_events`:** one row per unexpected server error.
  - `code`: a Postgres SQLSTATE (`42501` is permission denied), a
    PostgREST `PGRST...` code or an Auth code (the error's own, or that of
    the database error it wraps), or else an error's class name. A
    command's code that its action doesn't expect, a backstop such as
    `tasks.no_slots` or `members.invalid_position`, is recorded as `P0001`,
    the SQLSTATE of `raise exception`. The recorder never reads a message,
    so the route names the action but not the reason.
  - `route`: where it happened, never with a query string.
    - An error Next.js captures (a thrown page, Route Handler, Server Action
      or proxy) is `<routeType> <routePath>`: `render`, `route`, `action` or
      `proxy`, then the route's file pattern, so a thrown Server Action on
      the members page reads `action /(admin)/admin/members`. A `render`
      route drops the route group: a render error on Task detail reads
      `render /dashboard/tasks/[id]`, as staging recorded on 2026-11-02.
    - An unexpected error an action maps to its generic message is
      `action <actionName>`, such as `action moveTaskAction`.
    - The sites that catch a fault themselves name themselves:
      `render admin-banners #<n>` (the n-th banner source),
      `route /api/tasks/[id]/ics`, `route /auth/callback` and
      `action signInWithGoogleAction`.
  - `entity_type` and `entity_id`: the row an action was about.
  - `digest`: the id a member or admin page that failed to load shows as
    "Error ID: <digest>" (`<hash>@E<n>` for Next's own errors).
    - A page that fails in the browser rather than on the server shows no
      Error ID and writes no row.
  - **Rows per failed page:** on Vercel, one failed page load writes one
    row. Each **Try again** is a new request, so it writes a row of its
    own. Locally, `next dev` can write two identical rows for one render
    error, so count rows on staging, not under `next dev`.

Neither table holds names, emails, messages, tokens or request bodies.
`entity_id` is only a row id, but for `member` rows it is a member's id,
which an admin can join back to a person; a later erasure story should cover
it. Admins can read both; nobody writes them except the server's commands.
Run these in production's dashboard SQL Editor, or from `<app>` with
`pnpm exec supabase db query --workdir <prod> --linked "<query>"` (go-live
step 4). Without `--workdir <prod>`, `--linked` reaches staging.

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

The error behind a page that failed to load, which shows its digest as
"Error ID: <digest>":

```sql
select occurred_at, code, route, entity_type, entity_id
from public.error_events
where digest = '<digest>';
```

`error_events` rows are kept 30 days; from Epic 4, the daily job deletes older
ones.

## 6. Backups and restore

### What runs and what it leaves out

- **The workflow:** `Backup` (`.github/workflows/backup.yml`) in the private
  `pillar-portal-backups` repository. Its one secret, `SUPABASE_DB_URL`, is
  production's session-pooler URL (port 5432). It runs every Monday at 02:17
  PHT (Sunday 18:17 UTC; GitHub may start a scheduled run some minutes late),
  and whenever someone runs it with
  `gh workflow run backup.yml -R <owner>/pillar-portal-backups`. It stays
  disabled until go-live step 10 (`gh workflow list --all` shows it).
- **What it keeps:** the data of the `public`, `private` and `auth` schemas,
  dumped by the Supabase CLI's own `pg_dump` script on the runner and piped
  through `gzip` into `age`, encrypted to the public key in
  `age-recipients.txt`. No plaintext reaches the runner's disk or the log.
  The artifact holds four files:
  - `backup.sql.gz.age`, the encrypted dump;
  - `counts.tsv`, each table's row count as the dump streamed, which a
    restore is checked against;
  - `migrations.txt`, the database's migration versions, which a restore
    rebuilds the schema from;
  - `recipient.txt`, the public key it was encrypted to, which says which
    private key opens it.

  Counts, versions and the public key aren't data, so those three aren't
  encrypted.
- **What it leaves out:**
  - the schema: a restore rebuilds it from the migrations in
    `migrations.txt`, then loads the data;
  - every `auth` table but `users` and `identities`: the session,
    refresh-token, sign-in-flow and one-time-token tables, two-factor
    (`mfa_*`, `webauthn_*`), the OAuth, SAML and SCIM tables, the audit log
    (it holds IP addresses), and any table Supabase adds later. After a
    restore every member signs in again, and anyone who used two-factor sets
    it up again. `auth.users` keeps its own one-time token columns (the
    tokens of emailed links); a restore clears them, so no old emailed link
    works again;
  - Supabase's own schemas, and every file in Storage. After a restore, rows
    can point at files that are gone.
- **What it refuses:** a secret that isn't a session-pooler URL; a database
  password with characters other than letters, digits and `._~+=-` (the
  CLI's script would mangle them, so production's password is letters and
  digits only: go-live step 4); a dump that would carry other `auth` tables,
  or lacks `users` or `identities`; and a dump taken while the migrations or
  the `auth` tables changed. Each fails the run, records `failed` and
  uploads nothing.
- **The private keys** are only in the password manager and its sealed
  offline copy, never in a repository; without the right one no backup can
  be read. Label each in the password manager with the date it was made and
  its public key. After a key change, backups encrypted to the old key stay
  for 90 days: each artifact's `recipient.txt` says which key opens it.

### Where artifacts go

Each run that succeeds leaves one artifact, `backup-<n>` (`n` is its
`job_runs` id), kept 90 days: about 13 weekly backups. GitHub Free gives the
account that owns the repository 500 MB of artifact storage and 2,000
Actions minutes a month, shared with every other private repository it owns.
A run takes a few minutes, but 13 artifacts must fit in what the other
repositories leave: a backup over about 35 MB (the `bytes` in `job_runs`),
or another private repository storing artifacts, means fewer days kept or a
paid plan.

**Accepted risk: there is one copy.** Every backup lives only as one GitHub
account's 90-day artifacts. If that account is lost, or GitHub deletes its
artifacts, there is no backup until the next run, and production's database
is the only copy. A second copy (another account, or offline storage) costs
money or regular manual work, so under the $0 budget the Board accepts this
risk. The restore test proves the copy that exists.

### Seeing each run

- **The Actions tab** of `pillar-portal-backups`, or
  `gh run list -R <owner>/pillar-portal-backups --workflow backup.yml`. A
  scheduled run that fails emails whoever last changed the workflow's `cron`
  line: the role account, from go-live step 10.
- **`job_runs`** (section 5): each run is a `backup` row, `ok` with
  `{"bytes": <size>}`, `failed` with no detail, or `skipped` when another run
  was still open (the workflow run fails too). A run that couldn't reach the
  database records nothing.
- **The banner:** in production, every admin page shows "Last backup was
  <n> days ago." once the newest `ok` backup finished more than 8 days ago,
  and "No backup has run yet." while there is none. It is read on the next
  full load of an admin page, so a run that just finished shows after a
  reload.

### When a run fails

| What the run shows | Why | What to do |
|---|---|---|
| "The SUPABASE_DB_URL secret isn't set.", "SUPABASE_DB_URL must be the session pooler's URL…" or "SUPABASE_DB_URL has no password." | The secret is unset, is the direct connection or the transaction pooler (port 6543), or has something after the database name | `gh secret set SUPABASE_DB_URL -R <owner>/pillar-portal-backups` with the session pooler's URL pasted at the prompt |
| "The database password in SUPABASE_DB_URL has characters the backup can't pass safely to pg_dump." | The password has a character other than letters, digits and `._~+=-` | Reset the database password in the Supabase dashboard to letters and digits only, save it in the password manager, then set the secret again |
| The "Begin the run" step fails to connect, and `job_runs` has no row for that run | The database is unreachable (a wrong password, a paused project, an outage), so nothing was recorded | Check the project in the Supabase dashboard and the secret's password, then run the workflow again |
| "Another backup run is still open", and a `skipped` row | A run of `backup` is still open in `job_runs`, so this one didn't start | Wait until the open run is over an hour old, then run the workflow again: that start closes it `failed` (`{"reason":"abandoned"}`). The next scheduled run does the same |
| `pg_dump: error: aborting because of server version mismatch` | Supabase upgraded Postgres to a newer major version than the workflow's client | In `backup.yml`, bump `postgresql-client-<n>` and the `/usr/lib/postgresql/<n>/bin` line to the new major, then run the workflow again |
| "The dump holds no data: it has no rows of public.sections." | The database the secret reaches has no sections: it is empty, or not production | Check the secret is production's session-pooler URL, and that production's sections exist |
| "The backup would carry auth tables it must leave out." or "The backup is missing auth.users or auth.identities." | The dump didn't leave out exactly the `auth` tables it was told to: a CLI or Supabase change | Nothing was uploaded. Check how the pinned CLI handles `-x` and what `auth` holds now, fix `backup.yml`, then run the workflow again |
| "The schema changed during the backup; run it again." | A migration, or a Supabase upgrade of `auth`, landed while the dump ran | Run the workflow again |
| The dump step stops with a timeout after 20 minutes | The dump hung (a lock, a stalled pooler), or the database outgrew the limit | Run the workflow again. If it times out again, compare the `bytes` of recent runs, and raise the dump step's `timeout-minutes` (and the job's) in `backup.yml` |
| The upload step says the artifact storage quota has been hit | The account's 500 MB is full | Delete old artifacts of this or the other private repositories (`gh api` or the Actions tab), or pay for more storage, then run the workflow again |

Any other failure shows its step's own error. Once the begin step has
recorded the run, a failure anywhere after it, a timeout included, ends the
run `failed`.

The "no data" check proves the dump holds data, not which database it came
from. A secret pointing at another database that holds data (staging, say)
passes every check: the backups are of that database, and its `job_runs`
gets the rows. Production's banner is what shows it, 8 days after
production's last `ok` backup.

### The restore test

It proves a backup can be read and loaded, without touching production: the
backup goes into a throwaway local database. Run it after every change of
backup key (section 4) and once a semester, and record each in the log at
the end of this section. Go live runs the hosted test instead (step 11): the
real restore's steps 2–5, into a scratch Supabase project.

It needs a checkout of `pillar-portal` with `pnpm install` done (`<app>`), a
clone of `pillar-portal-backups` (`<backups>`, for its `restore/` files),
Docker (the daemon the local stack uses; export the same `DOCKER_HOST` if it
isn't the default), `age`, `gh` and the private key. Run each
`pnpm exec supabase` from `<app>`. `<backup>`, `<restore>` and `<src>` are
new, empty directories outside every repository, written as absolute paths.

**Open one `bash` session first** (type `bash`) and run every step in it,
through the clean-up. The commands are bash, not fish (the developer's
default shell), and `KEYS` and `pipefail` live only in that session.

1. **The key:** save the private key from the password manager into a file
   only you can read, outside every repository. Paste it at the terminal,
   never into an editor, whose swap files could keep a copy:

   ```bash
   set -o pipefail
   install -d -m 700 ~/.config/pillar-portal-backups
   (umask 077; cat > ~/.config/pillar-portal-backups/restore-key.txt)
   # paste the key, press Enter, then Ctrl-D
   KEYS=(-i ~/.config/pillar-portal-backups/restore-key.txt)
   ```

   Within 90 days of a key change, when the backup may be encrypted to the
   old key, save that one too and pass both:

   ```bash
   (umask 077; cat > ~/.config/pillar-portal-backups/restore-key-old.txt)
   KEYS+=(-i ~/.config/pillar-portal-backups/restore-key-old.txt)
   ```

2. **Download** the run's artifact (`gh run list` finds the run):

   ```bash
   gh run download <run id> -R <owner>/pillar-portal-backups -n backup-<n> -D <backup>
   ```

3. **Verify** that a saved key is the one in `recipient.txt`, and that the
   whole file decrypts and is complete. It writes nothing:

   ```bash
   for key in ~/.config/pillar-portal-backups/restore-key*.txt; do
     grep -qxF "$(age-keygen -y "${key}")" <backup>/recipient.txt && echo "${key} opens it"
   done
   age -d "${KEYS[@]}" <backup>/backup.sql.gz.age | gunzip -t && echo "the backup is complete"
   ```

4. **The throwaway database,** with the backup's own migrations and the
   source's versions of Auth and Postgres:

   ```bash
   cd <app>
   git fetch origin
   pnpm exec supabase init --workdir <restore>
   sed -i -e 's/^project_id = .*/project_id = "pillar-restore-test"/' \
     -e '/^\[db\]$/,/^\[/ { s/^port = .*/port = 55432/; s/^shadow_port = .*/shadow_port = 55430/ }' \
     <restore>/supabase/config.toml
   ```

   That runs it beside the local stack. Check that
   `<restore>/supabase/config.toml` now reads
   `project_id = "pillar-restore-test"`, that its `[db]` section has
   `port = 55432` and `shadow_port = 55430`, and that its `major_version` is
   the source's Postgres major (17 today).

   Copy in exactly the migrations listed in `migrations.txt`, from `main`:

   ```bash
   mkdir -p <restore>/supabase/migrations
   while read -r version; do
     file="$(git ls-tree --name-only origin/main supabase/migrations/ \
       | grep -E "^supabase/migrations/${version}_[^/]+\.sql$" || true)"
     if [[ -z "${file}" ]]; then echo "not on main: ${version}"; continue; fi
     git show "origin/main:${file}" > "<restore>/${file}"
   done < <backup>/migrations.txt
   ```

   A version printed as `not on main` reached the database from a pull
   request before its merge: copy that file from its branch with
   `git show origin/<branch>:supabase/migrations/<file> > <restore>/supabase/migrations/<file>`.

   Copy the source's Auth and Postgres versions, so the copy's `auth` tables
   have the columns the backup has. Linking writes them; link a separate
   workdir, never `<app>`, which stays linked where it was (if `link` asks
   for the database password, leave it blank):

   ```bash
   pnpm exec supabase init --workdir <src>
   pnpm exec supabase link --project-ref <source project ref> --workdir <src>
   mkdir -p <restore>/supabase/.temp
   cp <src>/supabase/.temp/gotrue-version <src>/supabase/.temp/postgres-version <restore>/supabase/.temp/
   ```

   Then start it. `db start` applies the migrations, and runs Auth's own
   migrations at the copied version:

   ```bash
   pnpm exec supabase db start --workdir <restore>
   pnpm exec supabase migration list --local --workdir <restore>
   docker exec supabase_db_pillar-restore-test psql -U postgres -X -A -t \
     -c 'select version from supabase_migrations.schema_migrations order by version' \
     | diff - <backup>/migrations.txt && echo "the migrations match"
   ```

   `migration list --local` must show exactly the versions in
   `migrations.txt`, which the last command checks.

5. **Load the backup** in one transaction, decrypting in the pipe, so no
   decrypted file is ever written:

   ```bash
   { cat <backups>/restore/prelude.sql
     age -d "${KEYS[@]}" <backup>/backup.sql.gz.age | gunzip
     cat <backups>/restore/check.sql
   } | docker exec -i supabase_db_pillar-restore-test \
         psql -U postgres -X -q -o /dev/null --single-transaction -v ON_ERROR_STOP=1 -f - \
     && echo "loaded"
   ```

   `prelude.sql` refuses a database that already has users, then empties
   every `public` and `private` table, since the migrations seed the
   sections, desks and positions. The backup sets
   `session_replication_role = replica`, so no trigger fires while it loads
   (members aren't recreated from `auth.users`, and roles aren't
   re-derived). `check.sql` refuses a load that brought nothing, such as a
   wrong key's, then clears `auth.users`' one-time token columns. Any error
   rolls the whole load back.

6. **Compare the counts** with the backup's own:

   ```bash
   docker exec -i supabase_db_pillar-restore-test psql -U postgres -X -q -f - \
     < <backups>/restore/counts.sql > <backup>/restored.tsv
   <backups>/restore/compare-counts.sh <backup>/counts.tsv <backup>/restored.tsv
   ```

   It passes when the backup lists `auth.users` and `auth.identities` and no
   other `auth` table, every table in `counts.tsv` (`members`,
   `member_positions`, `tasks` and `task_assignments` among them) has the
   same count in the copy, every `public` and `private` table in the copy is
   in the backup, and every `auth` table the backup leaves out is empty
   there. It prints each mismatch otherwise.

7. **Clean up,** then record the date in the log below:

   ```bash
   pnpm exec supabase stop --no-backup --workdir <restore>
   rm -r <restore> <src> <backup>
   rm ~/.config/pillar-portal-backups/restore-key*.txt
   cat <app>/supabase/.temp/project-ref
   exit
   ```

   The `cat` must print the same project ref as before the test, and `exit`
   closes the bash session.

### The real restore

When production's database is lost or broken beyond repair. The steps are
in order; access stays closed until step 11. The restore test's
preparations apply (`<app>`, `<backups>`, absolute paths, and its step 1's
keys); `<new>` is one more new, empty directory, the workdir for every CLI
command against the new project.

**Open one `bash` session first** (type `bash`) and run every step in it, as
in the restore test.

1. **Close access.** Pause the Vercel production project in the form go-live
   step 7's rehearsal recorded: `vercel project pause <project>`, or
   `vercel api /v1/projects/<project>/pause -X POST`. Step 11 resumes it in
   the same form. While paused, every page, `/api/health` included, answers
   503, so the uptime monitor alerts; that is expected. Then stop backups, so
   no run backs up the broken database:
   `gh workflow disable backup.yml -R <owner>/pillar-portal-backups`.
2. **Choose the newest artifact from before the damage**
   (`gh run list -R <owner>/pillar-portal-backups --workflow backup.yml`),
   download it to `<backup>` and verify it, as in the restore test's steps 2
   and 3.
3. **Build the new project from `<new>`.** Make a new project in Singapore
   in the role account's organization, with a database password of letters
   and digits only (save it in the password manager). Then give `<new>` the
   app's Supabase config and the backup's migrations:

   ```bash
   cd <app>
   git fetch origin
   mkdir -p <new>/supabase/migrations
   cp <app>/supabase/config.toml <new>/supabase/
   (umask 077; cat > <new>/supabase/.env.local)
   ```

   At that last command, paste the production Google OAuth client's two
   lines from the password manager, then press Ctrl-D:

   ```bash
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<the production client's ID>
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<its secret>
   ```

   Write them fresh like this; never copy a developer checkout's
   `supabase/.env.local`, which holds whichever client that checkout uses.
   Copy in the migrations in `migrations.txt` exactly as in the restore
   test's step 4, into `<new>` instead of `<restore>`. Production has one
   block in `config.toml`, `[remotes.production]`: set its `project_id` in
   `<new>/supabase/config.toml`, `<new>`'s own copy, to the new project's
   ref. Then:

   ```bash
   pnpm exec supabase link --project-ref <new project ref> --workdir <new>
   pnpm exec supabase db push --workdir <new>
   ```

   Then go through go-live steps 4–6 for it (step 4's workdir, link and push
   are the commands above, and step 6's `.env.local` is the one just
   written), with `--workdir <new>` on every CLI command (`config diff` and
   `config push` included). In step 6, `<new>`'s copy already has the new
   ref, so there is no pull request until step 9 below, and keep the
   production OAuth client; its redirect URI moves in step 9.
4. **Load the data** with `psql` 17 or newer on your machine. The password
   goes only into a password file only you can read, never onto a command
   line or into an editor:

   ```bash
   (umask 077; cat > <new>/pgpass)
   ```

   Paste one line, filled in from the dashboard (Connect › Session pooler),
   then press Ctrl-D:

   ```text
   <the session pooler's host>:5432:postgres:postgres.<new project ref>:<its database password>
   ```

   Then point `psql` at the new project for the rest of this session (none
   of these is secret), and load it as in the restore test's step 5:

   ```bash
   export PGHOST=<the session pooler's host> PGPORT=5432 PGDATABASE=postgres \
     PGUSER=postgres.<new project ref> PGSSLMODE=require PGPASSFILE=<new>/pgpass
   { cat <backups>/restore/prelude.sql
     age -d "${KEYS[@]}" <backup>/backup.sql.gz.age | gunzip
     cat <backups>/restore/check.sql
   } | psql -X -q -o /dev/null --single-transaction -v ON_ERROR_STOP=1 -f - \
     && echo "loaded"
   ```

   If it fails on a missing table or column, `<new>`'s migrations don't
   match `migrations.txt`. Nothing was loaded, since the load is one
   transaction.
5. **Compare the counts:**

   ```bash
   psql -X -q -f <backups>/restore/counts.sql > <backup>/restored.tsv
   <backups>/restore/compare-counts.sh <backup>/counts.tsv <backup>/restored.tsv
   ```

6. **Push the newer migrations,** the ones merged after the backup, from
   `<new>`, after copying in `main`'s full migrations directory:

   ```bash
   git -C <app> archive origin/main supabase/migrations | tar -x -C <new>
   pnpm exec supabase db push --workdir <new>
   ```

7. **Before access reopens, run the retention and erasure rules:** the
   backup still holds data that was due for deletion after it was taken.
   Run Epic 4's daily job (retention, and any cycle erasure that has come
   due), then repeat every applicant erasure made after the backup's date
   (Epic 6). Until those epics ship there is nothing to run; they add their
   commands here.
8. **Tell members what was lost:** everything done since the backup's date
   (tasks, slot answers, moves, approvals), every file uploaded (Storage
   isn't backed up), that everyone signs in again, and that anyone who used
   two-factor sets it up again.
9. **Repoint:**
   - Vercel production: `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and a new `SUPABASE_SECRET_KEY`
     (the `vercel env rm`, then `vercel env add`, of section 4), then
     redeploy;
   - Google Cloud: the production OAuth client's redirect URI becomes
     `https://<new project ref>.supabase.co/auth/v1/callback`;
   - `gh secret set SUPABASE_DB_URL -R <owner>/pillar-portal-backups`, with
     the new project's session-pooler URL pasted at the prompt;
   - the CLI: set `[remotes.production]`'s `project_id` in `<app>`'s
     `supabase/config.toml` to the new ref in a pull request, and merge it.
     Only once `<app>`'s `main` has the new ref, relink production's
     workdir from an up-to-date `main`
     (`pnpm exec supabase link --project-ref <new project ref> --workdir <prod>`),
     check that `cat <prod>/supabase/.temp/project-ref` prints the new ref,
     and run `pnpm exec supabase config diff --workdir <prod>` (with
     `.env.local`'s variables loaded, as in go-live step 6) before any push
     through `<prod>`.
10. **Check backups again:**
    `gh workflow enable backup.yml -R <owner>/pillar-portal-backups`, then
    `gh workflow run backup.yml -R <owner>/pillar-portal-backups`, and check
    the new project's `job_runs` shows a `backup` run `ok` (section 5). That
    also clears the banner, and closes the run that was open when the
    restored backup was taken (see below).
11. **Check health, reopen and clean up.** Check the new database answers
    (`select public.health_check()` in its SQL Editor), then resume the
    project in step 1's form: `vercel project resume <project>`, or
    `vercel api /v1/projects/<project>/unpause -X POST`. Check
    `https://<app host>/api/health` returns 200 and an admin can sign in, and
    record the date of the restore here. Then delete the key files and the
    `<backup>` and `<new>` directories (with `pgpass` and `.env.local` in
    it), check that `<app>/supabase/.temp/project-ref` still prints the ref
    it did before, and `exit` the bash session.

A restored database shows the backup's own run still open in `job_runs`:
the backup was taken while it ran. The next backup run closes it `failed`
with `{"reason":"abandoned"}` and then runs normally.

### Restore test log

One line per restore test: the date, why it ran (go live, key change or the
semester's test), the artifact, and who ran it.

- Not yet run.
